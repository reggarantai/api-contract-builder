import { type Context, isObject, own, type Segments, shown } from "./context";
import { counted } from "./notices";
import { pointerSegments, shownPointer, valueAt } from "./pointer";

// Where a `$ref` points inside the document. Nothing is ever fetched: a
// reference to another file or URL is refused (listed, so the document can
// be bundled), unless it names this document by its `$self` (3.2) or a
// schema in it by its `$id` (3.1), which RFC 3986 resolves against the
// base each schema is in.

export type Located =
  | { segments: string[] }
  /** Left as written: a schema's own `#/$defs/…`, or an anchor. */
  | { keep: true };

/** Keys whose values are data, never followed for `$id`, `$anchor`, or `$ref`. */
const DATA_KEYS = new Set([
  "examples",
  "example",
  "default",
  "enum",
  "const",
  "value",
  "dataValue",
  "serializedValue",
]);

/**
 * A place found while indexing: its key, and the place it's in. The
 * segments leading to it are worked out only for a place a reference
 * names, so indexing costs a few slots a value, however deep.
 */
type Found = { parent: Found | undefined; key: string };

function segmentsOf(found: Found | undefined): string[] {
  const segments: string[] = [];
  for (let at = found; at; at = at.parent) segments.push(at.key);
  return segments.reverse();
}

/** An absolute URI without its fragment, or undefined. */
function absolute(uri: string, base: string | undefined) {
  try {
    const url = base === undefined ? new URL(uri) : new URL(uri, base);
    return url;
  } catch {
    return undefined;
  }
}

function withoutFragment(url: URL) {
  const copy = new URL(url.href);
  copy.hash = "";
  return copy.href;
}

/** What follows `#` in a URL, as written (still percent-encoded). */
function fragmentOf(url: URL) {
  return url.hash.startsWith("#") ? url.hash.slice(1) : "";
}

export class References {
  private readonly ctx: Context;
  /** The document's own URI (3.2 `$self`), if it has one. */
  readonly documentBase: string | undefined;
  private readonly ids = new Map<string, Found | undefined>();
  private readonly anchors = new Map<string, Found | undefined>();
  /** The segments of places references named, worked out once. */
  private readonly places = new WeakMap<Found, string[]>();
  /**
   * Reference Objects resolved before, by the object itself (a place in
   * the document, however long its pointer): where the chain ends.
   */
  private readonly chains = new WeakMap<object, string[] | null>();

  constructor(ctx: Context) {
    this.ctx = ctx;
    const self = ctx.version === "3.2" ? own(ctx.doc, "$self") : undefined;
    this.documentBase =
      typeof self === "string" ? absolute(self, undefined)?.href : undefined;
    if (ctx.version !== "3.0") {
      this.index();
    }
  }

  /** Every `$id` and `$anchor` in the document, with the base each sits in. */
  private index() {
    const pending: [unknown, Found | undefined, string | undefined][] = [
      [this.ctx.doc, undefined, this.documentBase],
    ];
    for (let next = pending.pop(); next; next = pending.pop()) {
      const [value, found, outer] = next;
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          pending.push([item, { parent: found, key: String(index) }, outer]);
        });
        continue;
      }
      if (!isObject(value)) {
        continue;
      }
      let base = outer;
      const id = own(value, "$id");
      if (typeof id === "string") {
        const url = absolute(id, outer);
        if (url) {
          base = withoutFragment(url);
          if (!this.ids.has(base)) {
            this.ids.set(base, found);
          }
        }
      }
      const anchor = own(value, "$anchor");
      if (typeof anchor === "string" && base !== undefined) {
        this.anchors.set(`${base}#${anchor}`, found);
      }
      for (const key of Object.keys(value)) {
        if (!DATA_KEYS.has(key) && !key.startsWith("x-")) {
          pending.push([value[key], { parent: found, key }, base]);
        }
      }
    }
  }

  /** The segments of a place the index found. */
  private segments(found: Found | undefined): string[] {
    if (found === undefined) return [];
    let segments = this.places.get(found);
    if (!segments) {
      segments = segmentsOf(found);
      this.places.set(found, segments);
    }
    return segments;
  }

  /** The base URI at a place: `$self`, then each enclosing `$id`. */
  baseAt(segments: Segments): { base: string | undefined; resource: string[] } {
    let base = this.documentBase;
    let resource: string[] = [];
    let value: unknown = this.ctx.doc;
    for (let index = 0; index <= segments.length; index++) {
      if (isObject(value)) {
        const id = own(value, "$id");
        if (typeof id === "string" && this.ctx.version !== "3.0") {
          const url = absolute(id, base);
          if (url) {
            base = withoutFragment(url);
            resource = segments.slice(0, index);
          }
        }
      }
      if (index < segments.length) {
        value = valueAt(value, [segments[index] as string]);
      }
    }
    return { base, resource };
  }

  /**
   * Where a `$ref` at `at` points, in a schema whose base is `base` and whose
   * resource (the schema with that `$id`) starts at `resource`. Undefined
   * when it can't be followed; the problem is reported.
   */
  locate(
    ref: string,
    at: Segments,
    base: string | undefined,
    resource: Segments,
    inSchema: boolean,
  ): Located | undefined {
    if (ref.startsWith("#")) {
      return this.fragment(ref.slice(1), ref, at, resource, base, inSchema);
    }
    const url = absolute(ref, base);
    const uri = url && withoutFragment(url);
    const root =
      uri === undefined
        ? undefined
        : uri === this.documentBase
          ? []
          : inSchema && this.ids.has(uri)
            ? this.segments(this.ids.get(uri))
            : undefined;
    if (!url || !root) {
      this.ctx.refuse(
        at,
        `Refers to ${shown(ref, 200)}, another file or URL, which the app never reads${
          inSchema && this.ctx.version !== "3.0"
            ? " (or to a schema by an $id that no schema in this document has)"
            : ""
        }`,
      );
      return undefined;
    }
    return this.fragment(fragmentOf(url), ref, at, root, uri, inSchema);
  }

  private fragment(
    fragment: string,
    ref: string,
    at: Segments,
    root: Segments,
    base: string | undefined,
    inSchema: boolean,
  ): Located | undefined {
    const segments = pointerSegments(fragment);
    if (segments === null) {
      let name = fragment;
      try {
        name = decodeURIComponent(fragment);
      } catch {
        // Reported below as not a pointer.
      }
      // A plain name is a JSON Schema anchor (`#node`).
      if (inSchema && /^[A-Za-z_][-A-Za-z0-9._]*$/.test(name)) {
        const key = `${base}#${name}`;
        return base !== undefined && this.anchors.has(key)
          ? { segments: this.segments(this.anchors.get(key)) }
          : { keep: true };
      }
      this.ctx.refuse(at, `${shown(ref, 200)} isn't a valid JSON Pointer`);
      return undefined;
    }
    const target = [...root, ...segments];
    if (target.length === 0) {
      this.ctx.refuse(at, `${shown(ref, 200)} points at the whole document`);
      return undefined;
    }
    if (valueAt(this.ctx.doc, target) === undefined) {
      // How the app stores a schema's references to its own $defs.
      if (
        inSchema &&
        root.length === 0 &&
        /^\/(?:\$defs|definitions)\//.test(fragment)
      ) {
        return { keep: true };
      }
      this.ctx.refuse(
        at,
        `${shown(ref, 200)} points at nothing in this document`,
      );
      return undefined;
    }
    return { segments: target };
  }

  /**
   * A Reference Object at `at` followed to what it finally points at, or the
   * value itself when it isn't one. Each place is followed once, however
   * many references lead through it (so the work is bounded by how many
   * there are, which the document's own value limit bounds); a chain that
   * comes back is refused.
   */
  follow(
    value: unknown,
    at: Segments,
    /** What it is, when siblings of its `$ref` mean more than OpenAPI's usual. */
    what?: "a path item",
  ):
    | {
        value: unknown;
        at: Segments;
        summary?: unknown;
        description?: unknown;
      }
    | undefined {
    if (!isObject(value) || typeof own(value, "$ref") !== "string") {
      return { value, at };
    }
    // Its fields are read each time a shared part is used: counted.
    this.ctx.count(Object.keys(value).length);
    // OpenAPI 3.1 lets a reference override these two of its target.
    const overrides =
      this.ctx.version === "3.0"
        ? {}
        : {
            ...(Object.hasOwn(value, "summary")
              ? { summary: value.summary }
              : {}),
            ...(Object.hasOwn(value, "description")
              ? { description: value.description }
              : {}),
          };
    const ignored = Object.keys(value).filter(
      (key) =>
        key !== "$ref" &&
        (this.ctx.version === "3.0" ||
          (key !== "summary" && key !== "description")),
    );
    if (ignored.length > 0) {
      const pathItem = what === "a path item";
      this.ctx.note(
        pathItem ? "path-item-siblings" : "reference-siblings",
        [...at, ignored[0] as string],
        (count, examples) =>
          pathItem
            ? `Fields beside a path item's $ref aren't kept, since OpenAPI leaves how they combine with what it refers to undefined (${counted(count, "path")}: ${examples})`
            : `${count === 1 ? "A field" : `${count.toLocaleString("en-US")} fields`} beside a $ref ${count === 1 ? "isn't" : "aren't"} kept, since OpenAPI ignores ${count === 1 ? "it" : "them"}: ${examples}`,
        shown(ignored.join(", "), 100),
      );
    }
    const end = this.chainEnd(value, at);
    if (end === undefined) {
      return undefined;
    }
    return { value: valueAt(this.ctx.doc, end), at: end, ...overrides };
  }

  /**
   * Where the chain of references from `start` (the Reference Object at
   * `at`) ends. Each Reference Object is followed once, however many
   * chains pass through it.
   */
  private chainEnd(start: object, at: Segments): string[] | undefined {
    const known = this.chains.get(start);
    if (known !== undefined) {
      return known ?? undefined;
    }
    const passed: object[] = [];
    const places: Segments[] = [];
    const seen = new Set<object>();
    let value: unknown = start;
    let current: Segments = at;
    for (;;) {
      if (!isObject(value) || typeof own(value, "$ref") !== "string") {
        return this.settle(passed, [...current]) ?? undefined;
      }
      const cached = this.chains.get(value);
      if (cached !== undefined) {
        return this.settle(passed, cached) ?? undefined;
      }
      if (seen.has(value)) {
        this.ctx.refuse(
          current,
          `This reference comes back to itself through ${places
            .slice(0, 5)
            .map((segments) => shownPointer(segments, 200))
            .join(" → ")}`,
        );
        return this.settle(passed, null);
      }
      seen.add(value);
      passed.push(value);
      places.push(current);
      const located = this.locate(
        value.$ref as string,
        [...current, "$ref"],
        this.documentBase,
        [],
        false,
      );
      if (!located || "keep" in located) {
        if (located && "keep" in located) {
          this.ctx.refuse(
            [...current, "$ref"],
            "Expected a JSON Pointer into this document",
          );
        }
        return this.settle(passed, null);
      }
      current = located.segments;
      value = valueAt(this.ctx.doc, current);
    }
  }

  private settle(passed: object[], end: string[] | null) {
    for (const value of passed) {
      this.chains.set(value, end);
    }
    return end ?? undefined;
  }
}
