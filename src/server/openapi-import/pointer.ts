// JSON Pointers (RFC 6901) into an OpenAPI document: how imports name the
// places they report, and how `$ref`s inside a document point at others.

/** `["paths", "/pets", "get"]` → `/paths/~1pets/get` */
export function jsonPointer(segments: readonly (string | number)[]) {
  return segments
    .map(
      (segment) =>
        `/${String(segment).replace(/~/g, "~0").replace(/\//g, "~1")}`,
    )
    .join("");
}

/** The most characters of a pointer an import shows. */
export const SHOWN_POINTER_LENGTH = 1000;

/**
 * A JSON Pointer to show someone: cut to `max` characters, ending in "…".
 * It costs `max` however long the names leading there are, since a small
 * document can reach many places whose pointers are megabytes long.
 */
export function shownPointer(
  segments: readonly (string | number)[],
  max = SHOWN_POINTER_LENGTH,
) {
  let out = "";
  for (const segment of segments) {
    // Escaping only lengthens a segment, so its first `max` characters
    // tell whether it fits.
    out += `/${String(segment)
      .slice(0, max)
      .replace(/~/g, "~0")
      .replace(/\//g, "~1")}`;
    if (out.length > max) {
      return cut(out, max);
    }
  }
  return out;
}

/** `text` cut to `max` characters with "…", never splitting a character. */
function cut(text: string, max: number) {
  let kept = text.slice(0, max - 1);
  const last = kept.charCodeAt(kept.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    kept = kept.slice(0, -1);
  }
  return `${kept}…`;
}

/**
 * The segments of a JSON Pointer written as a URI fragment, after the `#`
 * (RFC 6901 §6): percent-decoded first, then `~1` → `/` and `~0` → `~`. Null
 * when it isn't one (a bad escape, or no leading `/`).
 */
export function pointerSegments(fragment: string): string[] | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    return null;
  }
  if (decoded === "") {
    return [];
  }
  if (!decoded.startsWith("/")) {
    return null;
  }
  const segments: string[] = [];
  for (const raw of decoded.slice(1).split("/")) {
    if (/~(?![01])/.test(raw)) {
      return null;
    }
    segments.push(raw.replace(/~1/g, "/").replace(/~0/g, "~"));
  }
  return segments;
}

const ARRAY_INDEX = /^(?:0|[1-9][0-9]*)$/;

/**
 * The value `segments` lead to, following own properties and array
 * indexes only (so `__proto__` or `constructor` lead nowhere they shouldn't),
 * or undefined.
 */
export function valueAt(
  root: unknown,
  segments: readonly string[],
  /** How many segments to follow; all of them by default. */
  length = segments.length,
): unknown {
  let value = root;
  for (let index = 0; index < length; index++) {
    const segment = segments[index] as string;
    if (Array.isArray(value)) {
      if (!ARRAY_INDEX.test(segment) || Number(segment) >= value.length) {
        return undefined;
      }
      value = value[Number(segment)];
    } else if (
      typeof value === "object" &&
      value !== null &&
      Object.hasOwn(value, segment)
    ) {
      value = (value as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return value;
}
