import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { buildSample, createTestApp } from "../test-utils";

// Checking and writing a schema recurse, and run out of stack somewhere past
// a few hundred levels, depending on the JIT. The API saves no more than 256,
// but data saved before can be deeper; here they run out on cue.
const failure = vi.hoisted(() => ({
  /** What checking the contract throws, if anything. */
  check: null as Error | null,
  /** What writing YAML throws, if anything. */
  yaml: null as Error | null,
}));
vi.mock("../export/openapi", async (importOriginal) => {
  const original = await importOriginal<typeof import("../export/openapi")>();
  return {
    ...original,
    validateContract: vi.fn(
      async (...args: Parameters<typeof original.validateContract>) => {
        if (failure.check) {
          throw failure.check;
        }
        return original.validateContract(...args);
      },
    ),
  };
});
vi.mock("yaml", async (importOriginal) => {
  const original = await importOriginal<typeof import("yaml")>();
  return {
    ...original,
    stringify: vi.fn((...args: Parameters<typeof original.stringify>) => {
      if (failure.yaml) {
        throw failure.yaml;
      }
      return original.stringify(...args);
    }),
  };
});

const TOO_DEEP =
  "A schema or example nests deeper than the exports can follow. Keep them within 256 levels, moving inner parts of schemas into models of their own.";

describe.each([
  ["checking it", "check"],
  ["writing it as YAML", "yaml"],
] as const)("exports of a contract nested too deeply for %s", (_, step) => {
  let t: ReturnType<typeof createTestApp>;
  let projectId: string;

  beforeEach(async () => {
    t = createTestApp();
    const response = await t.request("POST", "/api/projects", { name: "Deep" });
    projectId = ((await response.json()) as { id: string }).id;
    const model = await t.request("POST", `/api/projects/${projectId}/models`, {
      name: "Old",
    });
    // Saved before the limit, deeper than saved data can be now.
    let schema: Record<string, unknown> = { type: "string" };
    for (let level = 1; level < 400; level++) {
      schema = { type: "array", items: schema };
    }
    t.db.$client
      .prepare("update models set schema = ? where id = ?")
      .run(JSON.stringify(schema), ((await model.json()) as { id: string }).id);
    failure.check = null;
    failure.yaml = null;
    failure[step] = new RangeError("Maximum call stack size exceeded");
  });

  afterEach(() => {
    t.close();
  });

  it("refuse the OpenAPI download with a reason", async () => {
    const response = await t.request(
      "GET",
      `/api/projects/${projectId}/export/openapi?format=yaml`,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: TOO_DEEP });
  });

  it("show the reason in the report, as an error", async () => {
    const response = await t.request(
      "GET",
      `/api/projects/${projectId}/export/report`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      valid: false,
      errors: [TOO_DEEP],
      warnings: [],
    });
  });

  it("leave the OpenAPI file out of the Markdown bundle, as other errors do", async () => {
    const response = await t.request(
      "GET",
      `/api/projects/${projectId}/export/markdown`,
    );
    expect(response.status).toBe(200);
    const files = Object.keys(
      unzipSync(new Uint8Array(await response.arrayBuffer())),
    );
    expect(files).toContain("deep/README.md");
    expect(files.filter((name) => name.endsWith(".openapi.yaml"))).toEqual([]);
  });
});

describe("the export report", () => {
  it("checks a contract saved within the limit without writing it out", async () => {
    const t = createTestApp();
    failure.check = null;
    failure.yaml = null;
    try {
      const { projectId } = await buildSample(t);
      vi.mocked(stringify).mockClear();
      const report = await t.request(
        "GET",
        `/api/projects/${projectId}/export/report`,
      );
      expect(((await report.json()) as { valid: boolean }).valid).toBe(true);
      // Writing YAML takes several times as long as checking.
      expect(stringify).not.toHaveBeenCalled();
    } finally {
      t.close();
    }
  });
});

describe("the export report, at the nesting limit", () => {
  it("checks a contract saved at the limit without writing it out", async () => {
    const t = createTestApp();
    failure.check = null;
    failure.yaml = null;
    try {
      const value = (levels: number) => {
        let result: unknown = 0;
        for (let level = 0; level < levels; level++) {
          result = [result];
        }
        return result;
      };
      const schema = (levels: number) => {
        let result: Record<string, unknown> = { type: "string" };
        for (let level = 1; level < levels; level++) {
          result = { type: "array", items: result };
        }
        return result;
      };
      // An object schema whose one property is the rest, `levels` in all.
      const object = (levels: number) => ({
        type: "object",
        properties: { deep: schema(levels - 2) },
      });
      const base = `/api/projects/${((await (await t.request("POST", "/api/projects", { name: "Limit" })).json()) as { id: string }).id}`;
      const errorType = (await (
        await t.request("POST", `${base}/error-types`, {
          name: "deep",
          status: "422",
          title: "Deep",
          headers: object(256),
          body: {
            contentType: "application/json",
            schema: schema(256),
            example: value(256),
          },
        })
      ).json()) as { id: string };
      const endpoint = (await (
        await t.request("POST", `${base}/endpoints`, {
          method: "POST",
          path: "/deep",
        })
      ).json()) as {
        id: string;
        requestBody: Record<string, unknown>;
        responses: Record<string, unknown>[];
      };
      const examples = [{ id: "x", name: "x", summary: "", value: value(256) }];
      const saved = await t.request(
        "PATCH",
        `${base}/endpoints/${endpoint.id}`,
        {
          parameters: {
            path: { type: "object", properties: {} },
            query: object(256),
            header: object(256),
            cookie: { type: "object", properties: {} },
          },
          requestBody: {
            ...endpoint.requestBody,
            schema: schema(256),
            examples,
          },
          responses: [
            {
              ...endpoint.responses[0],
              headers: object(256),
              body: {
                contentType: "application/json",
                schema: schema(256),
                examples,
              },
            },
            {
              id: "e",
              status: "422",
              description: "Deep",
              headers: { type: "object", properties: {} },
              body: null,
              errors: [{ errorTypeId: errorType.id, examples }],
            },
          ],
        },
      );
      expect(saved.status).toBe(200);

      vi.mocked(stringify).mockClear();
      const report = await t.request("GET", `${base}/export/report`);
      expect(((await report.json()) as { valid: boolean }).valid).toBe(true);
      expect(stringify).not.toHaveBeenCalled();
    } finally {
      t.close();
    }
  });
});

describe("exports that fail for another reason", () => {
  it("still fail", async () => {
    const t = createTestApp();
    const response = await t.request("POST", "/api/projects", { name: "Deep" });
    const projectId = ((await response.json()) as { id: string }).id;
    failure.check = new Error("Something else broke");
    failure.yaml = null;
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const report = await t.request(
        "GET",
        `/api/projects/${projectId}/export/report`,
      );
      expect(report.status).toBe(500);
    } finally {
      silence.mockRestore();
      t.close();
    }
  });
});
