import { describe, expect, it } from "vitest";
import { SLUG_MAX_LENGTH, SLUG_PATTERN, slugify, uniqueSlug } from "./slug";

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

describe("uniqueSlug", () => {
  it("adds the first free numeric suffix", () => {
    const taken = new Set(["login", "login-2"]);
    expect(uniqueSlug("login", (slug) => taken.has(slug))).toBe("login-3");
    expect(uniqueSlug("signup", (slug) => taken.has(slug))).toBe("signup");
  });

  it("stays within the maximum length", () => {
    const base = "a".repeat(SLUG_MAX_LENGTH);
    const slug = uniqueSlug(base, (candidate) => candidate === base);

    expect(slug).toHaveLength(SLUG_MAX_LENGTH);
    expect(slug.endsWith("-2")).toBe(true);
  });
});
