import { crc32, deflateSync } from "node:zlib";

// Tiny, valid images for upload tests.

function pngChunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * An RGB PNG of the given size: plain grey, or random pixels with `noise`
 * (which barely compress, for testing size limits).
 */
export function makePng(width: number, height: number, { noise = false } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  let seed = 1;
  const nextByte = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % 256;
  };
  const rows = Array.from({ length: height }, () =>
    Buffer.concat([
      Buffer.from([0]),
      noise
        ? Buffer.from(Array.from({ length: width * 3 }, nextByte))
        : Buffer.alloc(width * 3, 0x99),
    ]),
  );
  const pixels = Buffer.concat(rows);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export const JPEG_1X1 = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);
export const GIF_1X1 = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);
export const WEBP_1X1 = Buffer.from(
  "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==",
  "base64",
);
export const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
);
