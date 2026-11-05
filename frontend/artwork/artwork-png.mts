/** Native RGBA PNG encoding, independent of display canvases and their alpha conversion. */
export async function artworkPng(
  pixels: Uint8ClampedArray,
  stride: number,
  bounds: { x: number; y: number; width: number; height: number },
): Promise<Blob> {
  const { x, y, width, height } = bounds;
  const rows = new Uint8Array(height * (width * 4 + 1));
  for (let row = 0; row < height; row++) {
    const offset = ((y + row) * stride + x) * 4;
    rows.set(pixels.subarray(offset, offset + width * 4), row * (width * 4 + 1) + 1);
  }
  const compressed = new Uint8Array(
    await new Response(
      new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate')),
    ).arrayBuffer(),
  );
  function chunk(type: string, data: Uint8Array) {
    const result = new Uint8Array(data.length + 12);
    const view = new DataView(result.buffer);
    view.setUint32(0, data.length);
    result.set(new TextEncoder().encode(type), 4);
    result.set(data, 8);
    let crc = 0xffffffff;
    for (const byte of result.subarray(4, -4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
    return result;
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  return new Blob(
    [
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', compressed),
      chunk('IEND', new Uint8Array()),
    ],
    { type: 'image/png' },
  );
}
