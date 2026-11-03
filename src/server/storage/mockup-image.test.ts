import { describe, expect, it } from "vitest";
import {
  GIF_1X1,
  JPEG_1X1,
  makePng,
  SVG,
  WEBP_1X1,
} from "../../../test/images";
import { checkMockupImage } from "./mockup-image";

describe("checkMockupImage", () => {
  it.each([
    ["PNG", makePng(7, 3), { type: "png", width: 7, height: 3 }],
    ["JPEG", JPEG_1X1, { type: "jpg", width: 1, height: 1 }],
    ["GIF", GIF_1X1, { type: "gif", width: 1, height: 1 }],
    ["WebP", WEBP_1X1, { type: "webp", width: 1, height: 1 }],
  ])("reads a %s by its content", (_, data, expected) => {
    expect(checkMockupImage(new Uint8Array(data))).toEqual(expected);
  });

  it.each([
    ["SVG, which can carry scripts", SVG],
    ["text", Buffer.from("not an image")],
    ["nothing", Buffer.alloc(0)],
    ["a cut-off PNG header", makePng(4, 4).subarray(0, 12)],
  ])("refuses %s", (_, data) => {
    expect(checkMockupImage(new Uint8Array(data))).toBeNull();
  });
});
