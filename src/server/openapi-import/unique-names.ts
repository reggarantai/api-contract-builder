// Names made unique by a number: the name, then name2, name3, … (with a
// separator), each cut to fit a length. Names that share their start,
// once cut, share their numbered names, so each cut start and length of
// number remembers how far its numbers are taken: claiming a name takes
// time linear in the names, however alike they are.

export type UniqueNameRules = {
  /** The most characters a name may have. */
  max: number;
  /** Between a name and its number, like "-" in `pets-2`. */
  separator: string;
  /** What counts as the same name, like ignoring case. */
  fold?: (name: string) => string;
  /** How a name is cut to a length; the start of it, by default. */
  cut?: (text: string, length: number) => string;
};

export class UniqueNames {
  private readonly taken = new Set<string>();
  /** By a cut start and a count of digits: the next number to try. */
  private readonly next = new Map<string, number>();
  private readonly rules: Required<UniqueNameRules>;

  constructor(rules: UniqueNameRules) {
    this.rules = {
      fold: (name) => name,
      cut: (text, length) => text.slice(0, length),
      ...rules,
    };
  }

  /** `base`, cut to fit, or the first free numbered name, from 2. */
  claim(base: string): string {
    const { max, separator, fold, cut } = this.rules;
    const plain = cut(base, max);
    if (!this.taken.has(fold(plain))) {
      this.taken.add(fold(plain));
      return plain;
    }
    for (let digits = 1; ; digits++) {
      const start = cut(base, max - separator.length - digits);
      const key = `${fold(start)}\u0000${digits}`;
      const low = digits === 1 ? 2 : 10 ** (digits - 1);
      const high = 10 ** digits - 1;
      for (let n = Math.max(low, this.next.get(key) ?? low); n <= high; n++) {
        const name = `${start}${separator}${n}`;
        if (!this.taken.has(fold(name))) {
          this.taken.add(fold(name));
          this.next.set(key, n + 1);
          return name;
        }
      }
      this.next.set(key, high + 1);
    }
  }
}
