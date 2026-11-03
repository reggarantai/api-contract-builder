import { describe, expect, it } from "vitest";
import type { Mockup } from "../../shared/pages";
import {
  testInput,
  testModel,
  testPage,
  testProject,
} from "../export/test-input";
import { projectFileReport } from "./export";

function mockups(count: number, pageId: string): Mockup[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `k${index}`,
    pageId,
    url: `/uploads/p1/k${index}.png`,
    originalName: `k${index}.png`,
    mimeType: "image/png",
    width: 1,
    height: 1,
    caption: "",
    createdAt: "2026-01-01T00:00:00.000Z",
  }));
}

const options = {
  generator: "API Contract Builder 1.2.3",
  appVersion: "1.2.3",
  limits: { maxImportBytes: 1024 ** 4, maxUploadBytes: 1024 ** 4 },
};

describe("the project file report", () => {
  it("warns when the file would have more entries than an import reads", () => {
    const report = projectFileReport(
      testInput({
        pages: [
          testPage("g1", "Gallery", [], { mockups: mockups(10_000, "g1") }),
        ],
      }),
      { ...options, sizeOf: () => 1 },
    );
    expect(report.issues).toEqual([
      "The file would hold 10,001 files, more than an import reads (10,000)",
    ]);
  });

  it("warns when the file would be too large to write", () => {
    const report = projectFileReport(
      testInput({
        pages: [testPage("g1", "Gallery", [], { mockups: mockups(5, "g1") })],
      }),
      { ...options, sizeOf: () => 1024 ** 3 },
    );
    expect(report.issues).toEqual([
      "The file would hold 5 GB, more than a project file can (4 GB), so it can't be downloaded",
    ]);
  });

  it("warns when project.json goes past what an import reads", () => {
    const report = projectFileReport(
      testInput({
        project: testProject(),
        models: [
          testModel("m1", "Codes", {
            type: "string",
            enum: Array.from({ length: 1_000_001 }, (_, index) => `c${index}`),
          }),
        ],
      }),
      { ...options, sizeOf: () => 1 },
    );
    // Pretty-printed, it's past the size limit too.
    expect(report.issues).toContainEqual(
      expect.stringMatching(
        /^Its project\.json can't be imported: The text holds more than 1,000,000 values \(line \d+, column \d+\)$/,
      ),
    );
  });
});
