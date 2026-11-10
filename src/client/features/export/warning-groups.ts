import type { LintIssue } from "@shared/export";

/** Warnings by kind, in the order each kind first comes. */
export function groupsOf(warnings: LintIssue[]) {
  const groups = new Map<LintIssue["kind"], LintIssue[]>();
  for (const warning of warnings) {
    const group = groups.get(warning.kind);
    if (group) group.push(warning);
    else groups.set(warning.kind, [warning]);
  }
  return [...groups];
}
