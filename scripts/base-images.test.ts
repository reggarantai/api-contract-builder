import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { baseImagesOf, compareBaseImages, imageRefOf } from "./base-images";

// The provenance of the published 0.1.1 image, trimmed to what's read here.
const provenance: unknown = JSON.parse(
  fs.readFileSync(path.resolve("test/fixtures/provenance.json"), "utf8"),
);

describe("imageRefOf", () => {
  it.each([
    [
      "pkg:docker/node@24-trixie-slim?platform=linux%2Famd64",
      "node:24-trixie-slim",
    ],
    [
      "pkg:docker/gcr.io/distroless/nodejs24-debian13@latest?platform=linux%2Farm64",
      "gcr.io/distroless/nodejs24-debian13:latest",
    ],
    ["pkg:docker/docker/dockerfile@1", "docker/dockerfile:1"],
  ])("%s → %s", (purl, ref) => {
    expect(imageRefOf(purl)).toBe(ref);
  });
});

describe("baseImagesOf", () => {
  it("lists the images the build started from, once each, without BuildKit's tools", () => {
    const images = baseImagesOf(provenance);

    expect(images.map((image) => image.ref)).toEqual([
      "node:24-trixie-slim",
      "gcr.io/distroless/nodejs24-debian13:latest",
    ]);
    expect(images.map((image) => image.digest.slice(0, 19))).toEqual([
      "sha256:54f84b4cf843",
      "sha256:51eee69b2503",
    ]);
  });

  it("refuses provenance without base images, instead of reporting no change", () => {
    expect(() => baseImagesOf({})).toThrow("No base images in the provenance");
  });
});

describe("compareBaseImages", () => {
  it("marks the images whose tag now points somewhere else", () => {
    const recorded = [
      { ref: "node:24-trixie-slim", digest: "sha256:aaa" },
      {
        ref: "gcr.io/distroless/nodejs24-debian13:latest",
        digest: "sha256:bbb",
      },
    ];
    const current: Record<string, string> = {
      "node:24-trixie-slim": "sha256:aaa",
      "gcr.io/distroless/nodejs24-debian13:latest": "sha256:ccc",
    };

    expect(compareBaseImages(recorded, (ref) => current[ref] ?? "")).toEqual([
      {
        ref: "node:24-trixie-slim",
        recorded: "sha256:aaa",
        current: "sha256:aaa",
        changed: false,
      },
      {
        ref: "gcr.io/distroless/nodejs24-debian13:latest",
        recorded: "sha256:bbb",
        current: "sha256:ccc",
        changed: true,
      },
    ]);
  });
});
