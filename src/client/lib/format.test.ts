import { describe, expect, it } from "vitest";
import { firstParagraph } from "./format";

describe("firstParagraph", () => {
  it("keeps the first paragraph of Markdown as plain text", () => {
    expect(
      firstParagraph(
        "# Stock **tracking** for the `warehouse_team`, see [docs](https://x.example).\nSecond line.\n\n- **Errors** are problems",
      ),
    ).toBe("Stock tracking for the warehouse_team, see docs. Second line.");
  });

  it("is empty for an empty description", () => {
    expect(firstParagraph("  \n ")).toBe("");
  });
});
