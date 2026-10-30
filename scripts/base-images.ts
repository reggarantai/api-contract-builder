/**
 * Says whether the base images of a published image have moved since it was
 * built, so the weekly rebuild only rebuilds when there's something new:
 *
 *   node scripts/base-images.ts reggarantai/api-contract-builder:0.1
 *
 * Prints "true" or "false"; the comparison goes to stderr. Node runs this file
 * as is (type stripping), so it uses only Node's own modules.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export type BaseImage = { ref: string; digest: string };

export type Comparison = {
  ref: string;
  recorded: string;
  current: string;
  changed: boolean;
};

type Dependency = { uri?: unknown; digest?: { sha256?: unknown } };
type PlatformProvenance = {
  SLSA?: { buildDefinition?: { resolvedDependencies?: Dependency[] } };
};

// BuildKit's own images (the Dockerfile frontend, the SBOM scanner) are in the
// provenance too, but they don't end up in the image.
const BUILD_TOOLS = /^docker\/(dockerfile|buildkit-)/;

/** "pkg:docker/node@24-trixie-slim?platform=linux%2Famd64" → "node:24-trixie-slim" */
export function imageRefOf(purl: string): string {
  const [name = "", tag = "latest"] = purl
    .replace(/^pkg:docker\//, "")
    .replace(/\?.*$/, "")
    .split("@");
  return `${name}:${tag}`;
}

/**
 * The images a build started from, once each, from its provenance as
 * `docker buildx imagetools inspect --format '{{json .Provenance}}'` prints it.
 * The digests are those of the tags' indexes, the same for every platform.
 */
export function baseImagesOf(provenance: unknown): BaseImage[] {
  const platforms: PlatformProvenance[] =
    typeof provenance === "object" && provenance !== null
      ? Object.values(provenance)
      : [];
  const images = new Map<string, BaseImage>();
  for (const platform of platforms) {
    for (const dependency of platform.SLSA?.buildDefinition
      ?.resolvedDependencies ?? []) {
      const { uri } = dependency;
      const sha256 = dependency.digest?.sha256;
      if (
        typeof uri !== "string" ||
        !uri.startsWith("pkg:docker/") ||
        typeof sha256 !== "string"
      ) {
        continue;
      }
      const ref = imageRefOf(uri);
      if (!BUILD_TOOLS.test(ref)) {
        const digest = `sha256:${sha256}`;
        images.set(`${ref}@${digest}`, { ref, digest });
      }
    }
  }
  if (images.size === 0) {
    throw new Error(
      "No base images in the provenance; was the image built with provenance?",
    );
  }
  return [...images.values()];
}

export function compareBaseImages(
  recorded: BaseImage[],
  currentDigestOf: (ref: string) => string,
): Comparison[] {
  return recorded.map(({ ref, digest }) => {
    const current = currentDigestOf(ref);
    return { ref, recorded: digest, current, changed: current !== digest };
  });
}

function inspect(ref: string, format: string) {
  return execFileSync(
    "docker",
    ["buildx", "imagetools", "inspect", ref, "--format", format],
    { encoding: "utf8" },
  ).trim();
}

function main(image: string | undefined) {
  if (!image) {
    console.error("usage: node scripts/base-images.ts <published image>");
    process.exit(2);
  }
  const recorded = baseImagesOf(
    JSON.parse(inspect(image, "{{json .Provenance}}")),
  );
  const comparisons = compareBaseImages(recorded, (ref) =>
    inspect(ref, "{{.Manifest.Digest}}"),
  );
  for (const { ref, recorded, current, changed } of comparisons) {
    console.error(
      changed
        ? `changed    ${ref}: ${recorded} → ${current}`
        : `unchanged  ${ref}: ${current}`,
    );
  }
  console.log(comparisons.some((c) => c.changed) ? "true" : "false");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2]);
}
