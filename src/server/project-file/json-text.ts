// Checks JSON text before JSON.parse reads it: the grammar of RFC 8259, with
// the line and column of a problem, plus two rules of I-JSON (RFC 7493):
// no name twice in one object (JSON.parse keeps the last one silently, so a
// careless merge could lose a change), and no number beyond what a double
// holds (JSON.parse turns 1e400 into Infinity, which is saved as null).
// Lone surrogates, which I-JSON also leaves out, are allowed: the API stores
// them in JSON columns and writes them back as escapes. It runs without
// recursion, and it stops at a nesting depth and a number of values, so
// whatever reads the text next has bounded work.

export type JsonTextProblem = {
  /** Broken text, a rule of I-JSON, or past a limit of this reader. */
  kind: "syntax" | "rule" | "limit";
  message: string;
  line: number;
  column: number;
  /** Dot path of the value the problem is in, like "pages.0.states.1". */
  path: string;
};

type Frame =
  | { kind: "object"; names: Set<string>; name: string | undefined }
  | { kind: "array"; index: number };

class Problem {
  readonly kind: JsonTextProblem["kind"];
  readonly message: string;
  readonly position: number;
  readonly path: string;

  constructor(
    kind: JsonTextProblem["kind"],
    message: string,
    position: number,
    path: string,
  ) {
    this.kind = kind;
    this.message = message;
    this.position = position;
    this.path = path;
  }
}

const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

function isDigit(code: number) {
  return code >= 0x30 && code <= 0x39;
}

function isHex(char: string | undefined) {
  return char !== undefined && /^[0-9A-Fa-f]$/.test(char);
}

function lineAndColumn(text: string, position: number) {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < position && index < text.length; index++) {
    if (text.charCodeAt(index) === 0x0a) {
      line++;
      lineStart = index + 1;
    }
  }
  return { line, column: position - lineStart + 1 };
}

export type JsonTextLimits = {
  /** Deeper than anything the API can store (JSON.stringify stops near 6,000). */
  maxDepth?: number;
  maxValues?: number;
  /**
   * Called for each integer a double can't hold exactly (JSON.parse reads
   * 9223372036854775807 as 9223372036854775808), with what gives the names
   * and indexes leading to it: working that out costs the depth, so only
   * call it for the ones reported. I-JSON says not to expect more precision
   * than a double's.
   */
  onInexactInteger?: (
    literal: string,
    place: () => (string | number)[],
  ) => void;
};

export function checkJsonText(
  text: string,
  {
    maxDepth = 10_000,
    maxValues = 1_000_000,
    onInexactInteger,
  }: JsonTextLimits = {},
): JsonTextProblem | null {
  try {
    scan(text, maxDepth, maxValues, onInexactInteger);
    return null;
  } catch (error) {
    if (!(error instanceof Problem)) {
      throw error;
    }
    return {
      kind: error.kind,
      message: error.message,
      path: error.path,
      ...lineAndColumn(text, error.position),
    };
  }
}

/** Whether a JSON integer literal names a number a double holds exactly. */
export function isExactInteger(literal: string) {
  const digits = literal.startsWith("-") ? literal.length - 1 : literal.length;
  // Doubles hold every integer of 15 digits.
  if (digits <= 15) {
    return true;
  }
  const value = Number(literal);
  return BigInt(literal) === BigInt(value);
}

function scan(
  text: string,
  maxDepth: number,
  maxValues: number,
  onInexactInteger: JsonTextLimits["onInexactInteger"],
) {
  const length = text.length;
  const stack: Frame[] = [];
  let at = 0;
  let values = 0;

  /** The names and indexes leading to the value being read. */
  const place = () =>
    stack.flatMap((frame): (string | number)[] =>
      frame.kind === "array"
        ? [frame.index]
        : frame.name === undefined
          ? []
          : [frame.name],
    );

  const path = (extra?: string) =>
    [
      ...stack.flatMap((frame) =>
        frame.kind === "array"
          ? [String(frame.index)]
          : frame.name === undefined
            ? []
            : [frame.name],
      ),
      ...(extra === undefined ? [] : [extra]),
    ].join(".");
  const fail = (
    message: string,
    position = at,
    kind: JsonTextProblem["kind"] = "syntax",
  ): never => {
    throw new Problem(kind, message, position, path());
  };
  const skipSpace = () => {
    while (at < length) {
      const code = text.charCodeAt(at);
      if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
        break;
      }
      at++;
    }
  };

  /** A string from its opening quote; the decoded text when `decode` is set. */
  const scanString = (decode: boolean) => {
    const start = at;
    at++;
    let decoded = "";
    let chunk = at;
    for (;;) {
      if (at >= length) {
        fail("This string never ends", start);
      }
      const code = text.charCodeAt(at);
      if (code === 0x22) {
        if (decode) decoded += text.slice(chunk, at);
        at++;
        return decoded;
      }
      if (code === 0x5c) {
        if (decode) decoded += text.slice(chunk, at);
        const escaped = text[at + 1];
        if (escaped === "u") {
          const hex = text.slice(at + 2, at + 6);
          if (![...hex].every(isHex) || hex.length < 4) {
            fail("Write \\u with four hexadecimal digits in this escape");
          }
          if (decode) decoded += String.fromCharCode(Number.parseInt(hex, 16));
          at += 6;
        } else if (escaped !== undefined && Object.hasOwn(ESCAPES, escaped)) {
          if (decode) decoded += ESCAPES[escaped];
          at += 2;
        } else {
          fail(
            `\\${escaped ?? ""} isn't an escape JSON knows; write \\\\ for a backslash`,
          );
        }
        chunk = at;
      } else if (code < 0x20) {
        fail("Control characters in strings must be escaped, like \\n");
      } else {
        at++;
      }
    }
  };

  const scanNumber = () => {
    const start = at;
    const digits = () => {
      if (!isDigit(text.charCodeAt(at))) {
        fail("This isn't a valid number", start);
      }
      while (isDigit(text.charCodeAt(at))) at++;
    };
    if (text[at] === "-") at++;
    if (text[at] === "0") {
      at++;
    } else {
      digits();
    }
    if (text[at] === ".") {
      at++;
      digits();
    }
    if (text[at] === "e" || text[at] === "E") {
      at++;
      if (text[at] === "+" || text[at] === "-") at++;
      digits();
    }
    const literal = text.slice(start, at);
    if (!Number.isFinite(Number(literal))) {
      fail(
        `${literal.length > 40 ? `${literal.slice(0, 37)}…` : literal} is too large for a JSON number`,
        start,
        "rule",
      );
    }
    if (
      onInexactInteger &&
      !/[.eE]/.test(literal) &&
      !isExactInteger(literal)
    ) {
      onInexactInteger(literal, place);
    }
  };

  skipSpace();
  if (at >= length) {
    fail("The text is empty");
  }

  let expectingValue = true;
  for (;;) {
    if (expectingValue) {
      skipSpace();
      const char = text[at];
      values++;
      if (values > maxValues) {
        fail(
          `The text holds more than ${maxValues.toLocaleString("en-US")} values`,
          at,
          "limit",
        );
      }
      if ((char === "{" || char === "[") && stack.length >= maxDepth) {
        fail(
          `Values are nested more than ${maxDepth.toLocaleString("en-US")} levels deep`,
          at,
          "limit",
        );
      }
      if (char === "{") {
        at++;
        skipSpace();
        if (text[at] === "}") {
          at++;
          expectingValue = false;
          continue;
        }
        stack.push({ kind: "object", names: new Set(), name: undefined });
        readName();
        continue;
      }
      if (char === "[") {
        at++;
        skipSpace();
        if (text[at] === "]") {
          at++;
          expectingValue = false;
          continue;
        }
        stack.push({ kind: "array", index: 0 });
        continue;
      }
      if (char === '"') {
        scanString(false);
      } else if (char === "-" || isDigit(text.charCodeAt(at))) {
        scanNumber();
      } else if (text.startsWith("true", at)) {
        at += 4;
      } else if (text.startsWith("false", at)) {
        at += 5;
      } else if (text.startsWith("null", at)) {
        at += 4;
      } else {
        fail("Expected a value");
      }
      expectingValue = false;
      continue;
    }

    skipSpace();
    const frame = stack.at(-1);
    if (!frame) {
      if (at < length) {
        fail("Unexpected text after the end of the JSON value");
      }
      return;
    }
    const char = text[at];
    if (frame.kind === "array") {
      if (char === ",") {
        at++;
        frame.index++;
        expectingValue = true;
      } else if (char === "]") {
        at++;
        stack.pop();
      } else {
        fail("Expected ',' or ']'");
      }
    } else if (char === ",") {
      at++;
      readName();
      expectingValue = true;
    } else if (char === "}") {
      at++;
      stack.pop();
    } else {
      fail("Expected ',' or '}'");
    }
  }

  /** A member name and its colon; the value comes next. */
  function readName() {
    skipSpace();
    const frame = stack.at(-1);
    if (frame?.kind !== "object") {
      return;
    }
    frame.name = undefined;
    if (text[at] !== '"') {
      fail("Expected a member name in double quotes");
    }
    const start = at;
    const name = scanString(true);
    if (frame.names.has(name)) {
      throw new Problem(
        "rule",
        `"${name.length > 60 ? `${name.slice(0, 57)}…` : name}" appears twice in this object`,
        start,
        path(name),
      );
    }
    frame.names.add(name);
    frame.name = name;
    skipSpace();
    if (text[at] !== ":") {
      fail("Expected ':' after the member name");
    }
    at++;
  }
}
