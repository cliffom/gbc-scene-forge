/** Download an already-validated server snapshot without modifying the editor. */
export async function downloadArchive(response: Response) {
  if (response.headers.get('Content-Type')?.split(';')[0] !== 'application/zip') {
    throw Error('The export response was not a ZIP archive.');
  }
  const filename = /filename="([a-zA-Z0-9._-]+\.zip)"/.exec(
    response.headers.get('Content-Disposition') || '',
  )?.[1];
  if (!filename) {
    throw Error('The export response did not include a valid filename.');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
