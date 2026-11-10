import type { ApiIssue } from "../../shared/api-error";
import { shownPointer } from "./pointer";

// What an import changed or left out, grouped so a document with a thousand
// operations gets a list to read, not a thousand lines: one notice per kind,
// with how many places and the first few, at the JSON Pointer of the first.

/** Entries past which the list only counts the rest. */
const MAX_NOTICES = 100;
/** Places a notice names before it says "and N more". */
const SHOWN_EXAMPLES = 3;
/** The most characters of an example a notice keeps. */
const EXAMPLE_LENGTH = 200;

type Place = readonly (string | number)[];

type Group = {
  at: Place;
  count: number;
  examples: string[];
  /** Examples are names, each shown once; `more` when there are others. */
  distinct: boolean;
  more: boolean;
  render: (count: number, examples: string) => string;
};

/** FNV-1a: a small number for what was noted at a place, to tell notes apart. */
function hash(text: string) {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** "a", "a and b", "a, b, and c", "a, b, c, and 4 more" */
export function listed(items: string[], count = items.length) {
  const more = count - items.length;
  const parts =
    more > 0 ? [...items, `${more.toLocaleString("en-US")} more`] : items;
  if (parts.length <= 2) {
    return parts.join(" and ");
  }
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

/** "1 model", "3 models" */
export function counted(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

function shortExample(example: string) {
  if (example.length <= EXAMPLE_LENGTH) {
    return example;
  }
  let kept = example.slice(0, EXAMPLE_LENGTH - 1);
  const last = kept.charCodeAt(kept.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) kept = kept.slice(0, -1);
  return `${kept}…`;
}

export class Notices {
  private readonly groups = new Map<string, Group>();
  /**
   * What was noted at each place: by the object the place is in, then its
   * key, a small number for each note (its kind and example hashed), and
   * a set only where a place has several. Places are told apart by what
   * they are, not by their pointers, which can be megabytes long.
   */
  private readonly seen = new WeakMap<
    object,
    Map<string | number, number | Set<number>>
  >();
  /** Stands for places in no object: the document itself, or the import. */
  private readonly loose = {};

  /**
   * Notes something at `at`, a place in the document, which is `key` of
   * `container` (or in no object). Notices with the same `kind` are one
   * entry; `render` gets their count and the first few `example`s, already
   * listed. The same kind at the same place counts once, so work done again
   * (a schema copied into two places) doesn't count twice.
   */
  add(
    kind: string,
    at: Place,
    container: object | undefined,
    render: (count: number, examples: string) => string,
    example?: string,
    /** Examples are names (like an extension's): each listed once. */
    { distinct = false }: { distinct?: boolean } = {},
  ) {
    const shown = example === undefined ? undefined : shortExample(example);
    const key = at.length === 0 ? "" : (at[at.length - 1] as string | number);
    const holder = container ?? this.loose;
    let keys = this.seen.get(holder);
    if (!keys) {
      keys = new Map();
      this.seen.set(holder, keys);
    }
    const what = hash(shown === undefined ? kind : `${kind}\u0000${shown}`);
    const noted = keys.get(key);
    if (noted === undefined) {
      keys.set(key, what);
    } else if (typeof noted === "number") {
      if (noted === what) return;
      keys.set(key, new Set([noted, what]));
    } else {
      if (noted.has(what)) return;
      noted.add(what);
    }
    const group = this.groups.get(kind);
    if (!group) {
      this.groups.set(kind, {
        at: [...at],
        count: 1,
        examples: shown === undefined ? [] : [shown],
        distinct,
        more: false,
        render,
      });
      return;
    }
    group.count++;
    if (shown === undefined || (distinct && group.examples.includes(shown))) {
      return;
    }
    if (group.examples.length < SHOWN_EXAMPLES) {
      group.examples.push(shown);
    } else {
      group.more = true;
    }
  }

  get size() {
    return this.groups.size;
  }

  list(): ApiIssue[] {
    const all = [...this.groups.values()].map((group) => ({
      path: shownPointer(group.at),
      message: group.render(
        group.count,
        group.distinct
          ? listed(group.more ? [...group.examples, "others"] : group.examples)
          : listed(group.examples, group.count),
      ),
    }));
    if (all.length <= MAX_NOTICES) {
      return all;
    }
    return [
      ...all.slice(0, MAX_NOTICES - 1),
      {
        path: "",
        message: `And ${counted(all.length - MAX_NOTICES + 1, "more kind")} of changes`,
      },
    ];
  }
}
