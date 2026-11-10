import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_NESTING } from "../../shared/json-schema";
import { OPENAPI_LIMITS, readOpenApiText, readOpenApiTextSync } from "./read";
import { moduleUrl, runCold } from "./test-cold";

// biome-ignore lint/suspicious/noExplicitAny: tests read parsed values loosely.
type Loose = any;

const utf8 = (text: string) => new TextEncoder().encode(text);

function read(text: string | Uint8Array, format: "json" | "yaml") {
  return readOpenApiText(typeof text === "string" ? utf8(text) : text, format);
}

async function value(
  text: string | Uint8Array,
  format: "json" | "yaml",
): Promise<Loose> {
  const result = await read(text, format);
  if ("error" in result) {
    throw new Error(`${result.error} ${JSON.stringify(result.issues)}`);
  }
  return result.value;
}

/** The error, with its first issue, of a text that's refused. */
async function refusal(text: string | Uint8Array, format: "json" | "yaml") {
  const result = await read(text, format);
  if (!("error" in result)) {
    throw new Error(`Expected a refusal, got ${JSON.stringify(result.value)}`);
  }
  return [
    result.error,
    ...result.issues.map((issue) => `${issue.path}: ${issue.message}`),
  ].join("\n");
}

function utf16(text: string, littleEndian: boolean, bom: boolean) {
  const units = [
    ...(bom ? [0xfeff] : []),
    ...[...text].flatMap((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code > 0xffff
        ? [
            0xd800 + ((code - 0x10000) >> 10),
            0xdc00 + ((code - 0x10000) & 0x3ff),
          ]
        : [code];
    }),
  ];
  const bytes = new Uint8Array(units.length * 2);
  const view = new DataView(bytes.buffer);
  units.forEach((unit, index) => {
    view.setUint16(index * 2, unit, littleEndian);
  });
  return bytes;
}

function utf32(text: string, littleEndian: boolean, bom: boolean) {
  const points = [
    ...(bom ? [0xfeff] : []),
    ...[...text].map((char) => char.codePointAt(0) ?? 0),
  ];
  const bytes = new Uint8Array(points.length * 4);
  const view = new DataView(bytes.buffer);
  points.forEach((point, index) => {
    view.setUint32(index * 4, point, littleEndian);
  });
  return bytes;
}

describe("the limits", () => {
  it("are the same as a project file's, and deep enough for any schema the app saves", async () => {
    expect(OPENAPI_LIMITS).toEqual({
      maxBytes: 16 * 1024 * 1024,
      maxDepth: MAX_NESTING + 16,
      maxValues: 1_000_000,
      maxYamlTokens: 1_000_000,
      maxYamlLines: 1_000_000,
      maxText: 16 * 1024 * 1024,
      maxExportText: 32 * 1024 * 1024,
    });
  });
});

describe("reading JSON", () => {
  it("reads a document, ignoring a byte order mark (RFC 8259 §8.1)", async () => {
    expect(await value('\uFEFF{"openapi": "3.1.0"}', "json")).toEqual({
      openapi: "3.1.0",
    });
  });

  it("refuses text that isn't UTF-8, naming the encoding JSON needs", async () => {
    expect(await refusal(new Uint8Array([0x7b, 0xff, 0x7d]), "json")).toMatch(
      /isn't UTF-8 text/,
    );
    expect(await refusal(utf16('{"a": 1}', true, true), "json")).toMatch(
      /UTF-16.*JSON must be UTF-8/s,
    );
    expect(await refusal(utf16('{"a": 1}', false, false), "json")).toMatch(
      /UTF-16.*JSON must be UTF-8/s,
    );
  });

  it("says where the text is broken", async () => {
    expect(await refusal('{\n  "a": 1,\n}', "json")).toMatch(
      /isn't valid JSON at line 3, column 1/,
    );
  });

  it("refuses names twice in one object and numbers a double can't hold (I-JSON)", async () => {
    expect(await refusal('{"a": 1, "a": 2}', "json")).toMatch(
      /"a" appears twice in this object/,
    );
    expect(await refusal('{"a": 1e400}', "json")).toMatch(/too large/);
  });

  it("refuses nesting deeper than the limit, which it checks without recursion", async () => {
    const deep = (levels: number) =>
      `${"[".repeat(levels)}0${"]".repeat(levels)}`;
    expect(await value(deep(OPENAPI_LIMITS.maxDepth), "json")).toBeDefined();
    expect(await refusal(deep(OPENAPI_LIMITS.maxDepth + 1), "json")).toMatch(
      /nested more than 272 levels/,
    );
    expect(await refusal(deep(100_000), "json")).toMatch(
      /nested more than 272/,
    );
  });

  it("refuses more values than the limit", async () => {
    const values = (count: number) => `[${"0,".repeat(count - 2)}0]`;
    expect(await value(values(OPENAPI_LIMITS.maxValues), "json")).toHaveLength(
      OPENAPI_LIMITS.maxValues - 1,
    );
    expect(await refusal(values(OPENAPI_LIMITS.maxValues + 1), "json")).toMatch(
      /more than 1,000,000 values/,
    );
  });

  it("reports integers that a double changes, with their place", async () => {
    const result = await read(
      '{"properties": {"size": {"maximum": 9223372036854775807, "minimum": 9007199254740992}}}',
      "json",
    );
    expect(result).toMatchObject({
      notices: [
        {
          path: "/properties/size/maximum",
          message: expect.stringMatching(
            /9223372036854775807 can't be held exactly.*9223372036854775808/,
          ),
        },
      ],
    });
  });

  it("keeps __proto__ as a key, without touching any prototype", async () => {
    const parsed = await value('{"__proto__": {"polluted": true}}', "json");
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(({} as Loose).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });

  it("works out the place of an inexact integer only for the ones it reports", {
    timeout: 60_000,
  }, async () => {
    // 700,000 of them: as deep as the limit allows, placing each one costs
    // its depth, so placing them all took seconds. Lazily, it reads as fast
    // as when they're near the top; timed against that, so a slower or
    // busier machine slows both.
    const numbers = `[${"12345678901234567890,".repeat(700_000)}1]`;
    const nested = (depth: number) =>
      `${'{"a":'.repeat(depth)}${numbers}${"}".repeat(depth)}`;
    const deep = OPENAPI_LIMITS.maxDepth - 2;
    const timeOf = async (text: string) => {
      let fastest = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 2; run++) {
        const started = performance.now();
        await read(text, "json");
        fastest = Math.min(fastest, performance.now() - started);
      }
      return fastest;
    };
    const shallow = await timeOf(nested(1));
    const deepest = await timeOf(nested(deep));
    expect(deepest).toBeLessThan(3 * shallow + 300);
    const result = await read(nested(deep), "json");
    if ("error" in result) throw new Error(result.error);
    expect(result.notices).toHaveLength(100);
    expect(result.notices[99]?.path).toBe(`${"/a".repeat(deep)}/99`);
  });

  it("shortens the places it reports, however long the names leading there", async () => {
    const name = "n".repeat(100_000);
    const result = await read(
      `{"${name}": {"${name}": 12345678901234567890}}`,
      "json",
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.notices[0]?.path).toMatch(/^\/n{900,}…$/);
    expect(result.notices[0]?.path.length).toBeLessThanOrEqual(1000);
  });
});

describe("reading YAML 1.2", () => {
  it("reads block and flow styles, comments, and block scalars", async () => {
    expect(
      await value(
        "# A comment\nopenapi: 3.1.0\ninfo: {title: Shop, version: '1'}\ndescription: |\n  Line one\n  Line two\nlist:\n  - a\n  - 'b'\n",
        "yaml",
      ),
    ).toEqual({
      openapi: "3.1.0",
      info: { title: "Shop", version: "1" },
      description: "Line one\nLine two\n",
      list: ["a", "b"],
    });
  });

  it("reads UTF-16 and UTF-32, by their byte order mark or their zero bytes (YAML 1.2.2 §5.2)", async () => {
    const text = "title: Café ☕ 𝄞\n";
    const expected = { title: "Café ☕ 𝄞" };
    for (const little of [true, false]) {
      for (const bom of [true, false]) {
        expect(await value(utf16(text, little, bom), "yaml")).toEqual(expected);
        expect(await value(utf32(text, little, bom), "yaml")).toEqual(expected);
      }
    }
    expect(await value(`\uFEFF${text}`, "yaml")).toEqual(expected);
  });

  it("refuses text in no encoding YAML has", async () => {
    expect(
      await refusal(new Uint8Array([0x61, 0x3a, 0x20, 0xff]), "yaml"),
    ).toMatch(/isn't UTF-8 text/);
  });

  it("takes the plain scalars of YAML 1.2's core schema, not YAML 1.1's", async () => {
    expect(
      await value(
        "a: yes\nb: 2001-12-14\nc: 0777\nd: 0o17\ne: 0x1F\nf: ~\ng: true\nh: 1.5\n",
        "yaml",
      ),
    ).toEqual({
      a: "yes",
      b: "2001-12-14",
      c: 777,
      d: 15,
      e: 31,
      f: null,
      g: true,
      h: 1.5,
    });
  });

  it("refuses a %YAML directive other than 1.2, since 1.1 reads the same text differently", async () => {
    expect(await refusal("%YAML 1.1\n---\na: 0777\n", "yaml")).toMatch(
      /says it's YAML 1\.1.*YAML 1\.2/s,
    );
    expect(await value("%YAML 1.2\n---\na: 0777\n", "yaml")).toEqual({
      a: 777,
    });
  });

  it("takes only the tags of the JSON schema ruleset (OpenAPI: Format)", async () => {
    expect(
      await value(
        "a: !!str 12\nb: !!int '3'\nc: !!float 1.5\nd: !!bool true\ne: !!null ''\nf: !!seq [1]\ng: !!map {x: 1}\nh: ! 4\n",
        "yaml",
      ),
    ).toEqual({
      a: "12",
      b: 3,
      c: 1.5,
      d: true,
      e: null,
      f: [1],
      g: { x: 1 },
      h: "4",
    });
    for (const [text, tag] of [
      ["a: !!binary aGk=\n", "!!binary"],
      ["a: !!timestamp 2001-12-14\n", "!!timestamp"],
      ["a: !!set {x}\n", "!!set"],
      ["a: !!omap [x: 1]\n", "!!omap"],
      ["a: !custom x\n", "!custom"],
      ["a: !!python/object:os.system x\n", "!!python/object:os.system"],
      [
        "a:\n  - !<tag:example.com,2026:thing> x\n",
        "tag:example.com,2026:thing",
      ],
    ] as const) {
      expect(await refusal(text, "yaml"), text).toMatch(
        new RegExp(
          `line \\d+, column \\d+.*${tag.replace(/[.*+?^${}()|[\]\\/!]/g, "\\$&")}`,
          "s",
        ),
      );
    }
  });

  it("refuses an allowed tag on a value it can't be, rather than guessing", async () => {
    expect(await refusal("a: !!int abc\n", "yaml")).toMatch(
      /line 1, column 4.*Unresolved tag/s,
    );
  });

  it("refuses merge keys, which YAML 1.2 doesn't have, and takes a quoted << as a key", async () => {
    expect(
      await refusal("x: &a {p: 1}\ny:\n  <<: *a\n  q: 2\n", "yaml"),
    ).toMatch(/line 3, column 3.*merge key/s);
    expect(await value("'<<': 1\n", "yaml")).toEqual({ "<<": 1 });
  });

  it("refuses keys twice in one mapping, in linear time", async () => {
    expect(await refusal("a: 1\nb: 2\na: 3\n", "yaml")).toMatch(
      /line 3, column 1.*"a" appears twice/s,
    );
    const keys = Array.from({ length: 40_000 }, (_, i) => `k${i}: ${i}`).join(
      "\n",
    );
    const started = performance.now();
    expect(Object.keys(await value(keys, "yaml"))).toHaveLength(40_000);
    // yaml's own uniqueKeys check is quadratic: 17 s for these keys.
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it("takes keys as the strings they're written as, and refuses other keys", async () => {
    expect(await value("200: ok\n1.0: x\ntrue: t\n", "yaml")).toEqual({
      "200": "ok",
      "1.0": "x",
      true: "t",
    });
    expect(await refusal("? [a, b]\n: c\n", "yaml")).toMatch(
      /line 1.*keys must be strings/is,
    );
  });

  it("refuses numbers JSON can't hold", async () => {
    for (const number of [".inf", "-.inf", ".nan", "1e400"]) {
      expect(await refusal(`a: ${number}\n`, "yaml"), number).toMatch(
        /line 1, column 4.*isn't a number JSON can hold/s,
      );
    }
  });

  it("reports integers that a double changes, as for JSON", async () => {
    expect(await read("a:\n  b: 9223372036854775807\n", "yaml")).toMatchObject({
      notices: [
        {
          path: "/a/b",
          message: expect.stringMatching(
            /9223372036854775807 can't be held exactly/,
          ),
        },
      ],
    });
    // Explicit keys: implicit ones can't be longer than 1,024 characters.
    const name = "n".repeat(100_000);
    const result = await read(
      `? "${name}"\n: ? "${name}"\n  : 9223372036854775807\n`,
      "yaml",
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.notices[0]?.path).toMatch(/^\/n{900,}…$/);
    expect(result.notices[0]?.path.length).toBeLessThanOrEqual(1000);
  });

  it("copies what an alias points at, and keeps an anchor's first meaning for later aliases", async () => {
    const parsed = await value(
      "shared: &s {x: 1}\nuses: [*s, *s]\na: &v 1\nb: &list [*v]\nc: &v 2\nd: *list\n",
      "yaml",
    );
    expect(parsed).toEqual({
      shared: { x: 1 },
      uses: [{ x: 1 }, { x: 1 }],
      a: 1,
      b: [1],
      c: 2,
      d: [1],
    });
    // Copies, not one object in several places.
    expect(parsed.uses[0]).not.toBe(parsed.uses[1]);
    const many = `e: &e {x: 1}\nl: [${Array(500).fill("*e").join(", ")}]\n`;
    expect((await value(many, "yaml")).l).toHaveLength(500);
  });

  it("stops aliases that expand past the value limit (billion laughs)", async () => {
    const lines = ["a: &a [x, x, x, x, x, x, x, x, x, x]"];
    for (let level = 1; level < 9; level++) {
      const name = String.fromCharCode(97 + level);
      const previous = String.fromCharCode(96 + level);
      lines.push(
        `${name}: &${name} [${Array(10).fill(`*${previous}`).join(", ")}]`,
      );
    }
    const started = performance.now();
    expect(await refusal(`${lines.join("\n")}\n`, "yaml")).toMatch(
      /more than 1,000,000 values.*aliases/s,
    );
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it("counts the text an alias copies, so a small file can't hold more than 16 MB of text", async () => {
    // 100 KB of text, copied 200 times: 20 MB.
    const text = `big: &b "${"x".repeat(100 * 1024)}"\nuses: [${"*b, ".repeat(199)}*b]\n`;
    expect(await refusal(text, "yaml")).toMatch(
      /more than 16 MB of text once its aliases are copied in/,
    );
    // Keys an alias copies count too.
    const keys = `map: &m {"${"k".repeat(100 * 1024)}": 1}\nuses: [${"*m, ".repeat(199)}*m]\n`;
    expect(await refusal(keys, "yaml")).toMatch(
      /more than 16 MB of text once its aliases are copied in/,
    );
    // 120 copies, 12 MB: within it.
    expect(
      (
        await value(
          `big: &b "${"x".repeat(100 * 1024)}"\nuses: [${"*b, ".repeat(119)}*b]\n`,
          "yaml",
        )
      ).uses,
    ).toHaveLength(120);
  });

  it("counts each value an alias copies against the limit, exactly", async () => {
    // a holds 1,000 values and its list; b copies it n times.
    const text = (copies: number) =>
      `a: &a [${Array(1000).fill("0").join(", ")}]\nb: [${Array(copies).fill("*a").join(", ")}]\n`;
    // 1 + (1 + 1,000) + (1 + 997 × 1,001) = 999,000 values.
    expect((await value(text(997), "yaml")).b).toHaveLength(997);
    // Two more copies: 1,001,002.
    expect(await refusal(text(999), "yaml")).toMatch(
      /more than 1,000,000 values/,
    );
  });

  it("refuses aliases that point at their own ancestors, or at no anchor before them", async () => {
    expect(await refusal("a: &a [1, *a]\n", "yaml")).toMatch(
      /line 1.*inside what it points at/s,
    );
    expect(await refusal("a: &a {b: {c: *a}}\n", "yaml")).toMatch(
      /inside what it points at/,
    );
    expect(await refusal("x: *nope\n", "yaml")).toMatch(
      /line 1, column 4.*\*nope.*no anchor/s,
    );
    expect(await refusal("x: *later\ny: &later 1\n", "yaml")).toMatch(
      /no anchor/,
    );
  });

  it("refuses more than one document, and an empty one", async () => {
    expect(await refusal("a: 1\n---\nb: 2\n", "yaml")).toMatch(
      /more than one YAML document/,
    );
    expect(await refusal("", "yaml")).toMatch(/empty/);
    expect(await refusal("# just a comment\n", "yaml")).toMatch(/empty/);
  });

  it("refuses nesting deeper than the limit before anything recursive runs", async () => {
    const flow = (levels: number) =>
      `a: ${"[".repeat(levels)}1${"]".repeat(levels)}\n`;
    const block = (levels: number) =>
      `${Array.from({ length: levels }, (_, i) => `${" ".repeat(i)}k:`).join("\n")} 1\n`;
    // The mapping holding `a` is one level, as in JSON.
    expect(
      await value(flow(OPENAPI_LIMITS.maxDepth - 1), "yaml"),
    ).toBeDefined();
    expect(await value(block(OPENAPI_LIMITS.maxDepth), "yaml")).toBeDefined();
    for (const text of [
      flow(OPENAPI_LIMITS.maxDepth),
      block(OPENAPI_LIMITS.maxDepth + 1),
      flow(100_000),
    ]) {
      expect(await refusal(text, "yaml")).toMatch(
        /nested more than 272 levels/,
      );
    }
    // Aliases can make a value deeper than the text is.
    const half = OPENAPI_LIMITS.maxDepth - 100;
    expect(
      await refusal(
        `a: &a ${"[".repeat(half)}1${"]".repeat(half)}\nb: ${"[".repeat(150)}*a${"]".repeat(150)}\n`,
        "yaml",
      ),
    ).toMatch(/nested more than 272 levels/);
  });

  it("counts every token and every line, so text without values can't use much memory", {
    timeout: 60_000,
  }, async () => {
    const started = performance.now();
    const tokens = OPENAPI_LIMITS.maxYamlTokens;
    for (const text of [
      `a:\n${"-\n".repeat(tokens)}`,
      `a: 1\n${"  # c\n".repeat(tokens)}`,
      `a: [${"[],".repeat(tokens)}[]]\n`,
      `a:\n${"- !!str\n".repeat(tokens)}`,
      // Ends of flow collections that never began.
      `a: 1\n${"]".repeat(tokens + 1)}\n`,
      `a: 1\n${"}".repeat(tokens + 1)}\n`,
    ]) {
      expect(await refusal(text, "yaml")).toMatch(
        /more than 1,000,000 YAML tokens.*JSON/s,
      );
    }
    // The parser keeps a token for each line break, blank lines too.
    const lines = OPENAPI_LIMITS.maxYamlLines;
    for (const text of [
      `a: 1\n${"\n".repeat(lines)}`,
      `a: 1\n${"\r\n".repeat(lines)}`,
      `a: 1\n${"  \n".repeat(lines)}`,
    ]) {
      expect(await refusal(text, "yaml")).toMatch(
        /more than 1,000,000 lines.*JSON/s,
      );
    }
    expect(await value(`a: 1\n${"\n".repeat(lines - 2)}`, "yaml")).toEqual({
      a: 1,
    });
    // Refused while counting, before any tree is built.
    expect(performance.now() - started).toBeLessThan(30_000);
  });

  it("keeps __proto__ as a key, without touching any prototype", async () => {
    const parsed = await value(
      "__proto__:\n  polluted: true\nconstructor: 1\n",
      "yaml",
    );
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(parsed.constructor).toBe(1);
    expect(({} as Loose).polluted).toBeUndefined();
  });

  it("keeps the text of plain scalars that aren't strings, for fields that must be text", async () => {
    const result = await read("info:\n  version: 1.0\n  title: 2026\n", "yaml");
    if ("error" in result) throw new Error(result.error);
    const info = (result.value as Loose).info;
    expect(info).toEqual({ version: 1, title: 2026 });
    expect(result.sourceText(info, "version")).toBe("1.0");
    expect(result.sourceText(info, "title")).toBe("2026");
  });

  it("says where the text is broken", async () => {
    expect(await refusal("a: [1, 2\n", "yaml")).toMatch(
      /isn't valid YAML.*line 2/s,
    );
    expect(await refusal("a:\n\t- 1\n", "yaml")).toMatch(/line 2, column 1/);
  });

  it("reads the sample's OpenAPI export as its JSON form reads", async () => {
    const golden = fs.readFileSync(
      path.resolve("test/golden/inventory.openapi.yaml"),
      "utf8",
    );
    const parsed = await value(golden, "yaml");
    expect(await value(JSON.stringify(parsed), "json")).toEqual(parsed);
    expect(parsed.openapi).toBe("3.1.0");
  });
});

describe("reading YAML in a worker", () => {
  it("reads the document there, and brings back the text of plain scalars", async () => {
    const result = await readOpenApiText(
      utf8("info:\n  version: 1.0\n  title: Shop\nlist: [1, 2]\n"),
      "yaml",
    );
    if ("error" in result) throw new Error(result.error);
    const info = (result.value as Loose).info;
    expect(result.value).toEqual({
      info: { version: 1, title: "Shop" },
      list: [1, 2],
    });
    expect(result.sourceText(info, "version")).toBe("1.0");
    expect(result.sourceText((result.value as Loose).list, 1)).toBe("2");
    // The same as reading it here.
    expect(readOpenApiTextSync(utf8("list: [1, 2]\n"), "yaml")).toMatchObject({
      value: { list: [1, 2] },
    });
  });

  it("refuses YAML that needs more memory than the worker may use, and goes on serving", async () => {
    const big = `a: [${"{},".repeat(400_000)}{}]\n`;
    expect(
      await readOpenApiText(utf8(big), "yaml", { yamlHeapMb: 32 }),
    ).toMatchObject({
      error: expect.stringMatching(
        /more memory to read than this instance.*JSON/s,
      ),
    });
    expect(await value("a: 1\n", "yaml")).toEqual({ a: 1 });
  });

  it("stops YAML that takes too long to read", async () => {
    expect(
      await readOpenApiText(utf8(`a: [${"1,".repeat(200_000)}1]\n`), "yaml", {
        yamlTimeoutMs: 1,
      }),
    ).toMatchObject({ error: expect.stringMatching(/took longer than/) });
  });

  it("brings back the text of scalars by their container, so a deep document costs this thread little", () => {
    // 60,000 numbers that keep their text (1.0), 260 levels deep: sent back
    // by their places, they cost scalars × depth here, more than a small
    // container has.
    const run = runCold(
      `
      import { readOpenApiText } from ${moduleUrl("src/server/openapi-import/read.ts")};
      const depth = 260;
      const inner = Array.from({ length: 60_000 }, (_, index) => "k" + index + ": 1.0").join(", ");
      const text = "foo: " + "{properties: ".repeat(depth) + "{" + inner + "}" + "}".repeat(depth) + "\\n";
      const read = await readOpenApiText(new TextEncoder().encode(text), "yaml");
      if ("error" in read) {
        console.log("refused:", read.error);
      } else {
        let container = read.value.foo;
        for (let level = 0; level < depth; level++) container = container.properties;
        console.log(read.sourceText(container, "k59999"));
      }
      `,
      { heapMb: 256 },
    );
    expect(run.output).toBe("1.0");
    expect(run.status).toBe(0);
  });

  it("reads one YAML document at a time, since each reader may use the server's whole heap", async () => {
    const order: string[] = [];
    const slow = readOpenApiText(
      utf8(`a: [${"1,".repeat(300_000)}1]\n`),
      "yaml",
      { yamlTimeoutMs: 400 },
    ).then(() => order.push("slow"));
    const quick = readOpenApiText(utf8("a: 1\n"), "yaml").then(() =>
      order.push("quick"),
    );
    await Promise.all([slow, quick]);
    expect(order).toEqual(["slow", "quick"]);
    // A reading that fails doesn't hold up the next.
    expect(await value("a: 2\n", "yaml")).toEqual({ a: 2 });
  });

  it("keeps nothing of a reading once it's done", () => {
    const run = runCold(
      `
      import { readOpenApiText } from ${moduleUrl("src/server/openapi-import/read.ts")};
      let ref;
      await (async () => {
        const read = await readOpenApiText(new TextEncoder().encode("a: [1, 2]\\n"), "yaml");
        ref = new WeakRef(read.value);
      })();
      await new Promise((resolve) => setTimeout(resolve, 50));
      globalThis.gc();
      await new Promise((resolve) => setTimeout(resolve, 50));
      globalThis.gc();
      console.log(ref.deref() === undefined ? "collected" : "still alive");
      `,
      { heapMb: 256, flags: ["--expose-gc"] },
    );
    expect(run.output).toBe("collected");
  });

  it("refuses YAML, saying why, when the reader's module is missing", async () => {
    expect(
      await readOpenApiText(utf8("a: 1\n"), "yaml", {
        yamlReader: new URL("file:///nowhere/yaml-reader.js"),
      }),
    ).toMatchObject({
      error: expect.stringMatching(/can't read YAML.*JSON/s),
    });
  });
});
