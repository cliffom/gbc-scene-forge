/** Browser-owned, read-only atlas folder selection and bounded bundle upload. */
import { record, string } from '../shared/decode.mts';

declare global {
  interface Window {
    showDirectoryPicker?: (options: {
      id: string;
      mode: 'read';
    }) => Promise<FileSystemDirectoryHandle>;
  }
}
export interface AtlasFolder {
  name: string;
  manifests: string[];
  read(path: string): Promise<File>;
}
export interface AtlasUpload {
  name: string;
  manifest: string;
  png: string;
}
const MAX_ENTRIES = 4096;
export function relativeParts(path: string): string[] {
  const parts = path.split('/');
  if (
    !path ||
    path.includes('\\') ||
    /^[a-z]:/i.test(path) ||
    parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw Error('Atlas paths must stay inside the manifest folder.');
  }
  return parts;
}
async function folderFromHandle(root: FileSystemDirectoryHandle): Promise<AtlasFolder> {
  const manifests: string[] = [];
  let visited = 0;
  async function scan(directory: FileSystemDirectoryHandle, prefix: string, depth: number) {
    if (depth > 8) {
      throw Error('Choose a smaller atlas folder with fewer nested directories.');
    }
    for await (const [name, handle] of directory.entries()) {
      if (++visited > MAX_ENTRIES) {
        throw Error('Choose a smaller atlas folder (at most 4096 entries).');
      }
      if (name.startsWith('.')) {
        continue;
      }
      if (handle.kind === 'file' && name.endsWith('.atlas.json')) {
        manifests.push(prefix + name);
      } else if (handle.kind === 'directory') {
        await scan(await directory.getDirectoryHandle(name), prefix + name + '/', depth + 1);
      }
    }
  }
  await scan(root, '', 0);
  return {
    name: root.name,
    manifests: manifests.sort(),
    async read(path) {
      const parts = relativeParts(path);
      let directory = root;
      for (const part of parts.slice(0, -1)) {
        directory = await directory.getDirectoryHandle(part);
      }
      return (await directory.getFileHandle(parts[parts.length - 1])).getFile();
    },
  };
}
export function folderFromFiles(files: File[]): AtlasFolder {
  if (!files.length || files.length > MAX_ENTRIES) {
    throw Error('Choose an atlas folder containing at most 4096 files.');
  }
  const root = relativeParts(files[0].webkitRelativePath)[0];
  const entries = new Map<string, File>();
  for (const file of files) {
    const parts = relativeParts(file.webkitRelativePath);
    if (parts[0] !== root || parts.length < 2) {
      throw Error('Choose one atlas folder.');
    }
    const path = parts.slice(1).join('/');
    if (entries.has(path)) {
      throw Error('Duplicate file path in selected folder.');
    }
    entries.set(path, file);
  }
  return {
    name: root,
    manifests: [...entries.keys()]
      .filter(
        (path) =>
          path.endsWith('.atlas.json') && !path.split('/').some((part) => part.startsWith('.')),
      )
      .sort(),
    read(path) {
      relativeParts(path);
      const file = entries.get(path);
      if (!file) {
        return Promise.reject(Error(`Missing atlas file: ${path}`));
      }
      return Promise.resolve(file);
    },
  };
}
export async function chooseFolder(
  fallback: HTMLInputElement,
  signal?: AbortSignal,
): Promise<AtlasFolder | null> {
  signal?.throwIfAborted();
  if (window.showDirectoryPicker) {
    try {
      const folder = await folderFromHandle(
        await window.showDirectoryPicker({ id: 'forge-atlas', mode: 'read' }),
      );
      signal?.throwIfAborted();
      return folder;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return null;
      }
      throw error;
    }
  }
  fallback.value = '';
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      fallback.removeEventListener('change', changed);
      fallback.removeEventListener('cancel', cancelled);
      signal?.removeEventListener('abort', cancelled);
    };
    const changed = () => {
      cleanup();
      try {
        resolve(fallback.files?.length ? folderFromFiles(Array.from(fallback.files)) : null);
      } catch (error) {
        reject(error instanceof Error ? error : Error(String(error)));
      }
    };
    const cancelled = () => {
      cleanup();
      resolve(null);
    };
    fallback.addEventListener('change', changed);
    fallback.addEventListener('cancel', cancelled);
    signal?.addEventListener('abort', cancelled, { once: true });
    fallback.click();
  });
}
export async function readBundle(folder: AtlasFolder, manifestPath: string): Promise<AtlasUpload> {
  const parts = relativeParts(manifestPath);
  if (!manifestPath.endsWith('.atlas.json') || !folder.manifests.includes(manifestPath)) {
    throw Error('Choose an atlas manifest from the selected folder.');
  }
  const file = await folder.read(manifestPath);
  if (file.size > 1024 * 1024) {
    throw Error('Atlas manifest exceeds 1 MiB.');
  }
  const manifest = await file.text();
  const data = record(JSON.parse(manifest));
  const png = string(data.png);
  relativeParts(png);
  const prefix = parts.slice(0, -1);
  let image: File;
  try {
    image = await folder.read([...prefix, ...relativeParts(png)].join('/'));
  } catch {
    throw Error(`Missing or unreadable atlas PNG: ${png}`);
  }
  if (!png.toLowerCase().endsWith('.png')) {
    throw Error('Atlas image must be PNG.');
  }
  if (image.size > 4 * 1024 * 1024) {
    throw Error('Atlas PNG exceeds 4 MiB.');
  }
  const bytes = new Uint8Array(await image.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return { name: parts[parts.length - 1], manifest, png: btoa(binary) };
}
