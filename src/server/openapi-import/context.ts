import type { ApiIssue } from "../../shared/api-error";
import { MAX_NESTING } from "../../shared/json-schema";
import { IssueList } from "../project-file/validate";
import { Notices } from "./notices";
import { shownPointer, valueAt } from "./pointer";
import { OPENAPI_LIMITS } from "./read";

// What every part of a conversion shares: the document, its version, what
// it reports, and the budget that bounds the work a small file can cause.

export type Version = "3.0" | "3.1" | "3.2";
export type Segments = readonly string[];
/** A JSON object of the document. */
export type Raw = Record<string, unknown>;

/** Stops a conversion at once, for a problem that makes going on pointless. */
export class Stop extends Error {}

export type SourceText = (
  container: object,
  key: string | number,
) => string | undefined;

/** A JSON object of the document (not an array, not null). */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The own value of `key`, never one from a prototype. */
export function own(value: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

/** Sets a key, `__proto__` too, as an own property. */
export function setOwn(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  if (key === "__proto__") {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    target[key] = value;
  }
}

export function shown(text: string, length = 60) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/**
 * A value of the document, to show in a message: text and numbers as they
 * are, other values by what they are. Never String() on an object: one
 * with its own toString (`{"toString": 1}`, valid JSON) makes that throw.
 */
export function shownValue(value: unknown, length = 60) {
  if (typeof value === "string") return shown(value, length);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return typeof value === "object" ? "an object" : typeof value;
}

/** Cuts text to `max` characters, ending it with "…", without splitting a character. */
export function shortened(text: string, max: number) {
  let cut = text.slice(0, max - 1);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
}

export class Context {
  readonly doc: Record<string, unknown>;
  readonly version: Version;
  readonly notices = new Notices();
  readonly problems = new IssueList();
  private values = 0;
  private readonly sourceText: SourceText | undefined;

  constructor(
    doc: Record<string, unknown>,
    version: Version,
    sourceText: SourceText | undefined,
  ) {
    this.doc = doc;
    this.version = version;
    this.sourceText = sourceText;
  }

  /** Counts values the converted document gets; past the budget, stops. */
  count(values = 1) {
    this.values += values;
    if (this.values > OPENAPI_LIMITS.maxValues) {
      throw new Stop(
        `This document becomes more than ${OPENAPI_LIMITS.maxValues.toLocaleString("en-US")} values once its references are copied in, more than a project holds: each part a reference points at (a response, a parameter, a header, an example, a schema that isn't a model) is copied into every place that uses it. Refer to schemas as models (components.schemas), which aren't copied, and to large parts from fewer places.`,
      );
    }
  }

  /** Stops when what's being written nests deeper than the app saves. */
  depth(levels: number, at: Segments) {
    if (levels > MAX_NESTING) {
      throw new Stop(
        `The schema or example at ${shownPointer(at, 200)} is nested more than ${MAX_NESTING} levels deep once its references are copied in, more than the app saves. Move inner parts into models of their own (components.schemas).`,
      );
    }
  }

  /** Something that keeps the document from being imported; stops at the 50th. */
  refuse(at: Segments, message: string) {
    this.problems.add(shownPointer(at), message);
    if (this.problems.full) {
      throw new Stop("");
    }
  }

  /**
   * Notes something at `at` (see Notices.add): counted once for each place,
   * which is told apart by the object it's in, found here.
   */
  note(
    kind: string,
    at: Segments,
    render: (count: number, examples: string) => string,
    example?: string,
    options?: { distinct?: boolean },
  ) {
    const container =
      at.length === 0 ? undefined : valueAt(this.doc, at, at.length - 1);
    this.notices.add(
      kind,
      at,
      typeof container === "object" && container !== null
        ? container
        : undefined,
      render,
      example,
      options,
    );
  }

  /**
   * A text field: a string, the text YAML read as a number or boolean
   * (`version: 1.0`), or undefined when it's absent or null. Anything else
   * is refused, at its place.
   */
  text(
    container: Record<string, unknown>,
    key: string,
    at: Segments,
  ): string | undefined {
    const value = own(container, key);
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return this.sourceText?.(container, key) ?? String(value);
    }
    this.refuse([...at, key], "Expected text");
    return undefined;
  }

  get issues(): ApiIssue[] {
    return this.problems.list;
  }
}
