import { describe, expect, it } from "vitest";
import { UniqueNames } from "./unique-names";

/** The loop the names replace: base, then base + n for n = 2, 3, …, cut to fit. */
function naive(options: {
  max: number;
  separator: string;
  fold: (name: string) => string;
  cut: (text: string, length: number) => string;
}) {
  const taken = new Set<string>();
  return (base: string) => {
    let name = options.cut(base, options.max);
    for (let n = 2; taken.has(options.fold(name)); n++) {
      const suffix = `${options.separator}${n}`;
      name = `${options.cut(base, options.max - suffix.length)}${suffix}`;
    }
    taken.add(options.fold(name));
    return name;
  };
}

/** mulberry32, the same on every run. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const slice = (text: string, length: number) => text.slice(0, length);
const trimmed = (text: string, length: number) =>
  text.slice(0, length).replace(/-+$/, "");

describe("unique names", () => {
  it("are the ones the loop gives, cut to fit, for alike names", () => {
    for (const options of [
      {
        max: 12,
        separator: "-",
        fold: (name: string) => name.toLowerCase(),
        cut: slice,
      },
      { max: 12, separator: "_", fold: (name: string) => name, cut: slice },
      { max: 12, separator: "-", fold: (name: string) => name, cut: trimmed },
    ]) {
      for (let seed = 1; seed <= 300; seed++) {
        const next = random(seed);
        const names = new UniqueNames(options);
        const loop = naive(options);
        for (let count = 0; count < 200; count++) {
          // Short names, and long ones that share their start: cut, they meet.
          const length = 1 + Math.floor(next() * 16);
          const base = Array.from(
            { length },
            () => "aAb-1"[Math.floor(next() * 5)],
          ).join("");
          expect(names.claim(base), `seed ${seed}`).toBe(loop(base));
        }
      }
    }
  });
});
