import { errorDetails } from '../errors.mts';
import { $ } from './dom.mts';
export const status = (message: string) => {
  $('status').textContent = message;
};
export const guarded =
  <Args extends unknown[]>(callback: (...args: Args) => unknown) =>
  async (...args: Args): Promise<void> => {
    try {
      await callback(...args);
    } catch (cause) {
      const error = errorDetails(cause);
      status(error.message);
    }
  };

export async function loadImage(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
