import { describe, expect, it } from "vitest";
import { checkJsonText } from "./json-text";

describe("checking JSON text", () => {
  it.each([
    "{}",
    "[]",
    '"text"',
    "0",
    "-0",
    "1.5e-3",
    "-12.25E+10",
    "true",
    "false",
    "null",
    ' \t\r\n{"a": [1, {"b": null}], "c": "\\u00e9\\n\\"\\\\\\/\\b\\f\\r\\t"} \n',
    // A lone surrogate is allowed: the API stores them in JSON columns.
    '"\\ud800"',
    // The same name in different objects is fine.
    '{"a": 1, "b": {"a": 2}}',
    '[{"a": 1}, {"a": 2}]',
    "1e308",
  ])("accepts %j", (text) => {
    expect(checkJsonText(text)).toBeNull();
  });

  it.each([
    ['{\n  "a": 1,\n  "b" 2\n}', 3, 7, /Expected ':'/],
    ["[1, 2,]", 1, 7, /Expected a value/],
    ['{"a": 01}', 1, 8, /Expected ',' or '}'/],
    ['{"a": "x', 1, 7, /never ends/],
    ['"a\tb"', 1, 3, /Control characters/],
    ['"\\x"', 1, 2, /escape/],
    ['"\\u12"', 1, 2, /escape/],
    ["NaN", 1, 1, /Expected a value/],
    ["{'a': 1}", 1, 2, /member name in double quotes/],
    ['{"a": 1} // note', 1, 10, /after the end/],
    ["", 1, 1, /empty/],
    ["  \n ", 2, 2, /empty/],
    ["[1 2]", 1, 4, /Expected ',' or '\]'/],
    ["1.", 1, 1, /number/],
    ["-", 1, 1, /number/],
    ["1e", 1, 1, /number/],
    ["tru", 1, 1, /Expected a value/],
    ['{"a": 1,}', 1, 9, /member name in double quotes/],
    ["[", 1, 2, /Expected a value/],
    ['{"a"', 1, 5, /Expected ':'/],
  ])(
    "finds the problem in %j at line %i, column %i",
    (text, line, column, message) => {
      const problem = checkJsonText(text);
      expect(problem).toMatchObject({ line, column });
      expect(problem?.message).toMatch(message);
    },
  );

  it("tells broken text from text over a rule", () => {
    expect(checkJsonText('{"a" 1}')?.kind).toBe("syntax");
    expect(checkJsonText('{"a": 1, "a": 2}')?.kind).toBe("rule");
    expect(checkJsonText("1e400")?.kind).toBe("rule");
    expect(checkJsonText("[1, 2]", { maxValues: 2 })?.kind).toBe("limit");
  });

  it("names the place of a problem", () => {
    expect(
      checkJsonText('{"pages": [{"name": "x", "states": [1,]}]}'),
    ).toMatchObject({ path: "pages.0.states.1" });
  });

  describe("duplicate names", () => {
    it.each([
      ['{"a": 1, "a": 2}', "a", 10],
      ['{"x": {"b": 1, "b": 2}}', "x.b", 16],
      ['[{"a": 1, "a": 1}]', "0.a", 11],
      ['{"a": 1, "\\u0061": 2}', "a", 10],
    ])("refuses %j", (text, path, column) => {
      const problem = checkJsonText(text);
      expect(problem).toMatchObject({ path, line: 1, column });
      expect(problem?.message).toMatch(/appears twice/);
    });
  });

  it.each([
    ['{"n": 1e400}', "n"],
    ["[-1e400]", "0"],
    ["1e309", ""],
  ])("refuses numbers too large for JSON in %j", (text, path) => {
    const problem = checkJsonText(text);
    expect(problem).toMatchObject({ path });
    expect(problem?.message).toMatch(/too large/);
  });

  describe("limits", () => {
    it("refuses nesting deeper than the limit, at the bracket that goes too deep", () => {
      expect(
        checkJsonText("[".repeat(10) + "]".repeat(10), { maxDepth: 10 }),
      ).toBeNull();
      expect(
        checkJsonText(`{"a": ${"[".repeat(10)}${"]".repeat(10)}}`, {
          maxDepth: 10,
        }),
      ).toMatchObject({
        line: 1,
        column: 16,
        message: "Values are nested more than 10 levels deep",
      });
    });

    it("refuses more values than the limit", () => {
      // The list and its three numbers.
      expect(checkJsonText("[1, 2, 3]", { maxValues: 4 })).toBeNull();
      expect(
        checkJsonText('[1, 2, 3, {"a": 4}]', { maxValues: 4 }),
      ).toMatchObject({
        column: 11,
        message: "The text holds more than 4 values",
      });
    });

    it("stops early at its default limits, however much text follows", () => {
      const started = performance.now();
      expect(checkJsonText("[".repeat(5_000_000))?.message).toBe(
        "Values are nested more than 10,000 levels deep",
      );
      expect(checkJsonText(`[${"0,".repeat(2_000_000)}0]`)?.message).toBe(
        "The text holds more than 1,000,000 values",
      );
      expect(performance.now() - started).toBeLessThan(3000);
    });

    it("follows nesting up to its limit without running out of stack", () => {
      expect(checkJsonText("[".repeat(10_000) + "]".repeat(10_000))).toBeNull();
      expect(checkJsonText("[".repeat(10_001))?.kind).toBe("limit");
    });
  });

  it("agrees with JSON.parse on what is JSON, apart from its two extra rules", () => {
    const samples = [
      '{"a": [1, 2.5, -3e2, true, false, null, "x\\n"], "b": {"c": {}}}',
      '[{"id": "a", "value": [1, [2, [3]]]}, "\\u00e9", 0]',
    ];
    const alphabet = '{}[]":,0123456789.eE+-tfnrulsa \\\n\t/';
    let seed = 7;
    const random = (limit: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % limit;
    };
    const inputs: string[] = [];
    for (let round = 0; round < 4000; round++) {
      const base = samples[round % samples.length] ?? "";
      const chars = [...base];
      for (let change = 0; change < 1 + random(3); change++) {
        const position = random(chars.length + 1);
        const char = alphabet[random(alphabet.length)] ?? "";
        const kind = random(3);
        if (kind === 0) chars.splice(position, 1);
        else if (kind === 1) chars.splice(position, 0, char);
        else chars[position] = char;
      }
      inputs.push(chars.join(""));
      inputs.push(
        Array.from(
          { length: random(12) },
          () => alphabet[random(alphabet.length)],
        ).join(""),
      );
    }
    for (const input of inputs) {
      let parsed = true;
      try {
        JSON.parse(input);
      } catch {
        parsed = false;
      }
      const problem = checkJsonText(input);
      if (parsed && problem) {
        expect(problem.message, input).toMatch(/appears twice|too large/);
      } else {
        expect(problem === null, input).toBe(parsed);
      }
    }
  });
});
