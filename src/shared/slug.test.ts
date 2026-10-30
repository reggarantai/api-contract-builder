import { describe, expect, it } from "vitest";
import { SLUG_MAX_LENGTH, SLUG_PATTERN, slugify } from "./slug";

describe("slugify", () => {
  it.each([
    ["Inventory App", "inventory-app"],
    ["Café Déjà Vu", "cafe-deja-vu"],
    ["  --Hello__World!! ", "hello-world"],
    ["API v2.1", "api-v2-1"],
    ["日本語", ""],
  ])("%j → %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("truncates long names without leaving a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(SLUG_MAX_LENGTH - 1)} b`);

    expect(slug).toHaveLength(SLUG_MAX_LENGTH - 1);
    expect(slug).toMatch(SLUG_PATTERN);
  });
});
