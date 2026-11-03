import { describe, expect, it } from "vitest";
import { formatSize } from "./format-size";

describe("formatSize", () => {
  it.each([
    [0, "0 bytes"],
    [1, "1 byte"],
    [1000, "1000 bytes"],
    [1024, "1 KB"],
    [20_000, "20 KB"],
    [1024 * 1024, "1 MB"],
    [1.5 * 1024 * 1024, "1.5 MB"],
    [1024 * 1024 * 1024, "1 GB"],
    [2.25 * 1024 * 1024 * 1024, "2.3 GB"],
  ])("writes %i bytes as %s", (bytes, text) => {
    expect(formatSize(bytes)).toBe(text);
  });
});
