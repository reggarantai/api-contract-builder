import type { LintIssue } from "@shared/export";
import { describe, expect, it } from "vitest";
import { groupsOf } from "./warning-groups";

const warning = (kind: LintIssue["kind"], id: string): LintIssue => ({
  kind,
  target: { type: "endpoint", id },
  message: `${id} isn't used by any page`,
});

describe("warnings on the Export tab", () => {
  it("come in groups by kind, in the order each kind first comes", () => {
    expect(
      groupsOf([
        warning("unused-endpoint", "a"),
        warning("missing-example", "b"),
        warning("unused-endpoint", "c"),
      ]),
    ).toEqual([
      [
        "unused-endpoint",
        [warning("unused-endpoint", "a"), warning("unused-endpoint", "c")],
      ],
      ["missing-example", [warning("missing-example", "b")]],
    ]);
  });

  it("are grouped in linear time, since an imported project can have tens of thousands", () => {
    const warnings = Array.from({ length: 40_000 }, (_, index) =>
      warning("unused-endpoint", `e${index}`),
    );
    const started = performance.now();
    const [[, group] = []] = groupsOf(warnings);
    expect(group).toHaveLength(40_000);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
