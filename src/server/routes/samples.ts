import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { buildInventorySample } from "../samples/inventory";

type Fetch = (url: string, init?: RequestInit) => Response | Promise<Response>;

/**
 * Creates the sample project by calling this app's own API, so the sample
 * goes through the same validation as anything a user makes.
 */
export function sampleRoutes(appFetch: Fetch, samplesDir: string) {
  const client = {
    request: (method: string, url: string, body?: unknown) =>
      appFetch(url, {
        method,
        headers:
          body === undefined
            ? undefined
            : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    upload: (
      url: string,
      files: { name: string; type: string; data: Uint8Array }[],
    ) => {
      const form = new FormData();
      for (const file of files) {
        form.append(
          "files",
          new File([file.data], file.name, { type: file.type }),
        );
      }
      return appFetch(url, { method: "POST", body: form });
    },
  };
  const readMockup = (name: string) =>
    fs.readFileSync(path.join(samplesDir, "mockups", `${name}.png`));

  return new Hono().post("/", async (c) => {
    let projectId: string | undefined;
    try {
      await buildInventorySample(client, readMockup, (id) => {
        projectId = id;
      });
    } catch (error) {
      // Don't leave half a sample behind.
      if (projectId) {
        await client.request("DELETE", `/api/projects/${projectId}`);
      }
      throw error;
    }
    const project = await client.request("GET", `/api/projects/${projectId}`);
    return c.json(await project.json(), 201);
  });
}
