import { isMainThread, parentPort, workerData } from "node:worker_threads";
import {
  Composer,
  type CST,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  Lexer,
  LineCounter,
  Parser,
  type YAMLMap,
  type YAMLSeq,
  type Node as YamlNode,
} from "yaml";
import type { ApiIssue } from "../../shared/api-error";

// Reads YAML 1.2 from someone else into plain values, with what OpenAPI asks
// of it ("Tags MUST be limited to those allowed by the JSON Schema
// ruleset"; keys are strings). It runs in a worker thread with a heap limit
// (see read.ts), so it loads nothing but yaml: a file that needs more memory
// than the instance has stops the worker, not the server.

export type YamlLimits = {
  maxTokens: number;
  maxLines: number;
  maxDepth: number;
  maxValues: number;
  /** Characters of strings and keys, aliases' copies included. */
  maxText: number;
};

/** What reading gives, as a worker can send it back. */
export type YamlRead =
  | {
      value: unknown;
      /** Numbers a double changes, at their JSON Pointer. */
      notices: ApiIssue[];
      /**
       * The text of each plain scalar that isn't a string (`version: 1.0`
       * is the number 1), as triples: the object or list it's in, its key
       * or index, and the text. A worker's answer keeps which object is
       * which, so this costs a few slots a scalar, however deep it is.
       */
      sources: (object | string | number)[];
    }
  | { error: string; issues: ApiIssue[] };

/** Notices of one kind past which a document only counts them. */
const MAX_NUMBER_NOTICES = 100;

function refusal(error: string): YamlRead {
  return { error, issues: [] };
}

function shown(text: string, length = 60) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/**
 * `["paths", "/pets"]` → `/paths/~1pets` (RFC 6901), cut to 1,000 characters
 * as pointer.ts's shownPointer does (this module loads nothing but yaml).
 */
function shownPointer(segments: readonly (string | number)[], max = 1000) {
  let out = "";
  for (const segment of segments) {
    out += `/${String(segment)
      .slice(0, max)
      .replace(/~/g, "~0")
      .replace(/\//g, "~1")}`;
    if (out.length > max) {
      let kept = out.slice(0, max - 1);
      const last = kept.charCodeAt(kept.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) kept = kept.slice(0, -1);
      return `${kept}…`;
    }
  }
  return out;
}

/** The notice of an integer a double changes. */
export function inexactNotice(literal: string, path: string): ApiIssue {
  return {
    path,
    message: `${shown(literal, 40)} can't be held exactly as a number, so it's ${shown(
      BigInt(Number(literal)).toString(),
      40,
    )}`,
  };
}

/**
 * What a lexer token costs the syntax tree: a line break is a small token
 * of its own, blank lines too; spaces come between other tokens, so those
 * two bound them; the marker before a scalar makes nothing, and the end of
 * a flow collection is counted with its start. Every other token can make
 * a node or holds memory of its own: an empty item (`-`), a key without a
 * value, a tag, an anchor, a comment.
 */
function tokenKind(lexeme: string): "token" | "line" | "end" | undefined {
  if (lexeme === "\n" || lexeme === "\r\n") {
    return "line";
  }
  if (lexeme === "]" || lexeme === "}") {
    return "end";
  }
  if (lexeme === "\x1f") {
    return undefined;
  }
  const first = lexeme[0];
  return first === " " || first === "\t" ? undefined : "token";
}

/** Composer options: YAML 1.2's core schema, with nothing it would guess. */
const COMPOSE_OPTIONS = {
  version: "1.2",
  schema: "core",
  merge: false,
  // Duplicates are found below with a Set: yaml compares each key with
  // every one before it (40,000 keys take 17 s).
  uniqueKeys: false,
  stringKeys: true,
  strict: true,
  intAsBigInt: false,
} as const;

/** The tags of YAML's JSON schema ruleset, and `!`, the non-specific one. */
const ALLOWED_TAGS = new Set([
  "!",
  "tag:yaml.org,2002:null",
  "tag:yaml.org,2002:bool",
  "tag:yaml.org,2002:int",
  "tag:yaml.org,2002:float",
  "tag:yaml.org,2002:str",
  "tag:yaml.org,2002:seq",
  "tag:yaml.org,2002:map",
]);

function shownTag(tag: string) {
  return tag.startsWith("tag:yaml.org,2002:")
    ? `!!${tag.slice("tag:yaml.org,2002:".length)}`
    : tag;
}

/** The offset of the deepest collection past `limit` levels, found without recursion. */
function tooDeep(tokens: CST.Token[], limit: number): number | undefined {
  const pending: [CST.Token, number][] = tokens.map((token) => [token, 0]);
  for (let next = pending.pop(); next; next = pending.pop()) {
    const [token, depth] = next;
    if (token.type === "document") {
      if (token.value) pending.push([token.value, depth]);
      continue;
    }
    if (
      token.type !== "block-map" &&
      token.type !== "block-seq" &&
      token.type !== "flow-collection"
    ) {
      continue;
    }
    const inner = depth + 1;
    if (inner > limit) {
      return token.offset;
    }
    for (const item of token.items) {
      if ("key" in item && item.key) pending.push([item.key, inner]);
      if (item.value) pending.push([item.value, inner]);
    }
  }
  return undefined;
}

class YamlProblem {
  readonly offset: number;
  readonly message: string;
  constructor(offset: number, message: string) {
    this.offset = offset;
    this.message = message;
  }
}

export function readYamlText(text: string, limits: YamlLimits): YamlRead {
  let tokens = 0;
  let lines = 0;
  let open = 0;
  for (const lexeme of new Lexer().lex(text)) {
    let kind = tokenKind(lexeme);
    if (lexeme === "[" || lexeme === "{") {
      open++;
    } else if (kind === "end") {
      // One that never began becomes an error of its own, which costs more.
      if (open > 0) open--;
      else kind = "token";
    }
    if (kind === "token" && ++tokens > limits.maxTokens) {
      return refusal(
        `This file has more than ${limits.maxTokens.toLocaleString("en-US")} YAML tokens, more than the app reads from YAML. Save it as JSON, which takes much less memory to read, and import that.`,
      );
    }
    if (kind === "line" && ++lines > limits.maxLines) {
      return refusal(
        `This file has more than ${limits.maxLines.toLocaleString("en-US")} lines, more than the app reads from YAML. Save it as JSON, which takes much less memory to read, and import that.`,
      );
    }
  }

  const lineStarts = new LineCounter();
  const position = (offset: number) => {
    const { line, col } = lineStarts.linePos(offset);
    return line === 0
      ? `line 1, column ${col + 1}`
      : `line ${line}, column ${col}`;
  };
  let cst: CST.Token[] = [...new Parser(lineStarts.addNewLine).parse(text)];
  if (cst.filter((token) => token.type === "document").length > 1) {
    return refusal(
      "This file holds more than one YAML document; an OpenAPI document is one",
    );
  }
  const deep = tooDeep(cst, limits.maxDepth);
  if (deep !== undefined) {
    return refusal(
      `This file can't be read at ${position(deep)}: Values are nested more than ${limits.maxDepth} levels deep`,
    );
  }
  const documents = [...new Composer(COMPOSE_OPTIONS).compose(cst)];
  cst = [];
  const document = documents[0];
  if (!document || document.contents === null) {
    return refusal("This file is empty");
  }
  const declared = document.directives?.yaml;
  if (declared?.explicit && declared.version !== "1.2") {
    return refusal(
      `This file says it's YAML ${declared.version} (%YAML ${declared.version}). OpenAPI documents are YAML 1.2, which reads some values differently (0777, yes, dates); remove the directive if the document means the same in YAML 1.2.`,
    );
  }
  const [error] = document.errors;
  if (error) {
    return refusal(
      `This file isn't valid YAML at ${position(error.pos[0])}: ${error.message}`,
    );
  }

  let read: YamlRead;
  try {
    // Before the warnings: tags OpenAPI doesn't allow get a message that
    // says so, rather than yaml's "Unresolved tag".
    read = walkYaml(document.contents, limits);
  } catch (problem) {
    if (problem instanceof YamlProblem) {
      return refusal(
        `This file can't be read at ${position(problem.offset)}: ${problem.message}`,
      );
    }
    throw problem;
  }
  // Each one is something yaml had to guess, like `!!int abc`.
  const [warning] = document.warnings;
  if (warning) {
    return refusal(
      `This file can't be read at ${position(warning.pos[0])}: ${warning.message}`,
    );
  }
  return read;
}

type Container = { [key: string]: unknown } | unknown[];

type Frame = {
  node: YAMLMap | YAMLSeq;
  out: Container;
  index: number;
  depth: number;
  /** Inside a copy of what an alias points at. */
  copying: boolean;
  /** The key or index this container has in its parent. */
  place: string | number | undefined;
  keys: Set<string> | undefined;
};

/** Sets a key, `__proto__` too, as an own property. */
function setOwn(
  target: { [key: string]: unknown },
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

function offsetOf(node: YamlNode | null | undefined) {
  return node?.range?.[0] ?? 0;
}

/**
 * The document's values, as JSON would have them. Aliases are copied, each
 * copy counted as values, so a small file can't expand past the limit; an
 * alias resolves to the anchor before it in the text, once, so copies keep
 * that meaning; never with yaml's own Alias.resolve, which walks the whole
 * document each time.
 */
function walkYaml(root: YamlNode, limits: YamlLimits): YamlRead {
  const anchors = new Map<string, YamlNode>();
  const aliasTargets = new WeakMap<YamlNode, YamlNode>();
  const open = new Set<YamlNode>();
  const sources: (object | string | number)[] = [];
  const notices: ApiIssue[] = [];
  let inexact = 0;
  let values = 0;
  let text = 0;
  const stack: Frame[] = [];
  /** Counts text the document holds; a copy an alias makes counts again. */
  const addText = (length: number, node: YamlNode | null | undefined) => {
    text += length;
    if (text > limits.maxText) {
      throw new YamlProblem(
        offsetOf(node),
        `The document holds more than ${Math.round(limits.maxText / 1024 / 1024)} MB of text once its aliases are copied in (each copy counts), more than a document may have`,
      );
    }
  };
  let result: unknown;

  const pointerTo = (place: string | number) =>
    shownPointer([
      ...stack.flatMap((frame) =>
        frame.place === undefined ? [] : [frame.place],
      ),
      place,
    ]);

  const checkTag = (node: YamlNode) => {
    if (node.tag !== undefined && !ALLOWED_TAGS.has(node.tag)) {
      throw new YamlProblem(
        offsetOf(node),
        `${shown(shownTag(node.tag))} is a YAML tag OpenAPI documents can't use; they're limited to those of YAML's JSON schema, like !!str and !!int`,
      );
    }
  };

  /** Reads `start` into `set`; collections are read by the loop below. */
  const visit = (
    start: YamlNode | null | undefined,
    depth: number,
    copying: boolean,
    place: string | number | undefined,
    set: (value: unknown) => void,
    container: object | undefined,
  ) => {
    let node = start ?? null;
    let copy = copying;
    if (node && isAlias(node)) {
      let target = aliasTargets.get(node);
      if (!target) {
        target = anchors.get(node.source);
        if (!target) {
          throw new YamlProblem(
            offsetOf(node),
            `*${shown(node.source)} has no anchor (&${shown(node.source)}) before it`,
          );
        }
        aliasTargets.set(node, target);
      }
      if (open.has(target)) {
        throw new YamlProblem(
          offsetOf(node),
          `*${shown(node.source)} is inside what it points at, so it would never end`,
        );
      }
      node = target;
      copy = true;
    }
    if (++values > limits.maxValues) {
      throw new YamlProblem(
        offsetOf(start),
        `The document holds more than ${limits.maxValues.toLocaleString("en-US")} values (YAML aliases copy what they point at, each copy counted)`,
      );
    }
    if (node === null) {
      set(null);
      return;
    }
    if (!copy && node.anchor) {
      anchors.set(node.anchor, node);
    }
    checkTag(node);
    if (isScalar(node)) {
      const { value } = node;
      if (typeof value === "number") {
        if (!Number.isFinite(value)) {
          throw new YamlProblem(
            offsetOf(node),
            `${shown(String(node.source))} isn't a number JSON can hold`,
          );
        }
        const literal = String(node.source).replace(/^\+/, "");
        if (
          Number.isInteger(value) &&
          !Number.isSafeInteger(value) &&
          /^-?(?:[0-9]+|0x[0-9a-fA-F]+|0o[0-7]+)$/.test(literal) &&
          BigInt(literal) !== BigInt(value) &&
          inexact++ < MAX_NUMBER_NOTICES
        ) {
          notices.push(
            inexactNotice(BigInt(literal).toString(), pointerTo(place ?? "")),
          );
        }
      } else if (typeof value === "string") {
        addText(value.length, start);
      } else if (value !== null && typeof value !== "boolean") {
        throw new YamlProblem(
          offsetOf(node),
          "This value isn't one JSON can hold",
        );
      }
      if (
        typeof value !== "string" &&
        container !== undefined &&
        place !== undefined &&
        node.type === "PLAIN" &&
        typeof node.source === "string"
      ) {
        sources.push(container, place, node.source);
      }
      set(value);
      return;
    }
    if (!isMap(node) && !isSeq(node)) {
      throw new YamlProblem(
        offsetOf(node),
        "This value isn't one JSON can hold",
      );
    }
    const inner = depth + 1;
    if (inner > limits.maxDepth) {
      throw new YamlProblem(
        offsetOf(start),
        `Values are nested more than ${limits.maxDepth} levels deep`,
      );
    }
    const out: Container = isMap(node) ? {} : [];
    set(out);
    open.add(node);
    stack.push({
      node,
      out,
      index: 0,
      depth: inner,
      copying: copy,
      place,
      keys: isMap(node) ? new Set() : undefined,
    });
  };

  visit(
    root,
    0,
    false,
    undefined,
    (value) => {
      result = value;
    },
    undefined,
  );

  while (stack.length > 0) {
    const frame = stack[stack.length - 1] as Frame;
    const items = frame.node.items as unknown[];
    if (frame.index >= items.length) {
      stack.pop();
      open.delete(frame.node);
      continue;
    }
    const index = frame.index++;
    if (frame.keys) {
      const pair = items[index] as {
        key: YamlNode | null;
        value: YamlNode | null;
      };
      const key = pair.key;
      if (!key || !isScalar(key) || typeof key.value !== "string") {
        throw new YamlProblem(
          offsetOf(key ?? frame.node),
          "Keys must be strings in OpenAPI documents",
        );
      }
      checkTag(key);
      if (!frame.copying && key.anchor) {
        anchors.set(key.anchor, key);
      }
      const name = key.value;
      if (name === "<<" && key.type === "PLAIN") {
        throw new YamlProblem(
          offsetOf(key),
          "<< is a merge key, which YAML 1.2 doesn't have; write out the keys it would merge",
        );
      }
      if (frame.keys.has(name)) {
        throw new YamlProblem(
          offsetOf(key),
          `"${shown(name)}" appears twice in this mapping`,
        );
      }
      frame.keys.add(name);
      addText(name.length, key);
      const target = frame.out as { [key: string]: unknown };
      visit(
        pair.value,
        frame.depth,
        frame.copying,
        name,
        (value) => {
          setOwn(target, name, value);
        },
        target,
      );
    } else {
      const target = frame.out as unknown[];
      visit(
        items[index] as YamlNode | null,
        frame.depth,
        frame.copying,
        index,
        (value) => {
          target.push(value);
        },
        target,
      );
    }
  }

  return { value: result, notices, sources };
}

/** What the worker is started with. */
export type YamlTask = {
  kind: typeof YAML_TASK;
  text: string;
  limits: YamlLimits;
};
export const YAML_TASK = "api-contract-builder/openapi-yaml";

// In the worker read.ts starts: read, answer, and end.
if (!isMainThread && (workerData as YamlTask | undefined)?.kind === YAML_TASK) {
  const task = workerData as YamlTask;
  parentPort?.postMessage(readYamlText(task.text, task.limits));
}
