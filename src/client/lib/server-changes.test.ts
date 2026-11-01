import { describe, expect, it } from "vitest";
import { serverChange } from "./server-changes";

describe("serverChange", () => {
  const known = { values: { name: "Items" }, revision: 3 };
  const idle = { saving: false, hasChanges: false };
  const editing = { saving: false, hasChanges: true };

  it("ignores what it already has, and responses that arrive late", () => {
    expect(serverChange(known, { ...known }, idle)).toBe("ignore");
    expect(
      serverChange(known, { values: { name: "Old" }, revision: 2 }, idle),
    ).toBe("ignore");
  });

  it("leaves a save in progress to reset the form from its own result", () => {
    expect(
      serverChange(
        known,
        { values: { name: "Elsewhere" }, revision: 4 },
        { saving: true, hasChanges: true },
      ),
    ).toBe("ignore");
  });

  it("takes new data while the form has no changes", () => {
    expect(
      serverChange(known, { values: { name: "Elsewhere" }, revision: 4 }, idle),
    ).toBe("take");
    // A mockup delete changes a page's states without a new revision.
    expect(
      serverChange(known, { values: { name: "Pruned" }, revision: 3 }, idle),
    ).toBe("take");
  });

  it("keeps the form's changes, moving on when only other fields changed", () => {
    expect(
      serverChange(known, { values: { name: "Items" }, revision: 4 }, editing),
    ).toBe("rebase");
    expect(
      serverChange(
        known,
        { values: { name: "Elsewhere" }, revision: 4 },
        editing,
      ),
    ).toBe("keep");
  });
});
