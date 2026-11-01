import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makePng } from "../../../test/images";
import { apiErrorSchema } from "../../shared/api-error";
import {
  type Endpoint,
  endpointResponseFieldsSchema,
} from "../../shared/endpoints";
import type { PageState, StateCause } from "../../shared/page-states";
import { type Page, pageSchema } from "../../shared/pages";
import { projectSchema } from "../../shared/projects";
import { createTestApp } from "../test-utils";

const NO_HEADERS = { type: "object", properties: {} };

describe("page states API", () => {
  let t: ReturnType<typeof createTestApp>;
  let base: string;
  let listItems: Endpoint;
  let deleteItem: Endpoint;
  let page: Page;

  beforeEach(async () => {
    t = createTestApp();
    const project = projectSchema.parse(
      await (await t.request("POST", "/api/projects", { name: "Shop" })).json(),
    );
    base = `/api/projects/${project.id}`;
    const itemHasStock = (await (
      await t.request("POST", `${base}/error-types`, {
        name: "item-has-stock",
        status: "409",
        title: "Item still in stock",
        body: {
          contentType: "application/problem+json",
          schema: { type: "object" },
          example: { title: "Item still in stock", status: 409 },
        },
      })
    ).json()) as { id: string };
    listItems = await endpoint("GET", "/items", [
      {
        id: "r200",
        status: "200",
        description: "OK",
        headers: NO_HEADERS,
        body: {
          contentType: "application/json",
          schema: { type: "object" },
          examples: [
            { id: "x1", name: "first-page", summary: "", value: { data: [1] } },
            { id: "x2", name: "empty", summary: "", value: { data: [] } },
          ],
        },
        errors: [],
      },
    ]);
    deleteItem = await endpoint("DELETE", "/items/{id}", [
      {
        id: "r204",
        status: "204",
        description: "No Content",
        headers: NO_HEADERS,
        body: null,
        errors: [],
      },
      {
        id: "r409",
        status: "409",
        description: "Conflict",
        headers: NO_HEADERS,
        body: null,
        errors: [{ errorTypeId: itemHasStock.id, examples: [] }],
      },
    ]);
    page = pageSchema.parse(
      await (
        await t.request("POST", `${base}/pages`, { name: "Stock list" })
      ).json(),
    );
    await patchPage({
      endpoints: [
        { id: "l1", endpointId: listItems.id, trigger: "on_load", note: "" },
        { id: "l2", endpointId: deleteItem.id, trigger: "on_action", note: "" },
      ],
    });
  });

  afterEach(() => {
    t.close();
  });

  async function endpoint(method: string, path: string, responses: unknown) {
    const created = endpointResponseFieldsSchema.parse(
      await (
        await t.request("POST", `${base}/endpoints`, { method, path })
      ).json(),
    );
    const response = await t.request(
      "PATCH",
      `${base}/endpoints/${created.id}`,
      { responses },
    );
    expect(response.status).toBe(200);
    return endpointResponseFieldsSchema.parse(await response.json());
  }

  function patchPage(body: unknown) {
    return t.request("PATCH", `${base}/pages/${page.id}`, body);
  }

  async function getPage() {
    return pageSchema.parse(
      await (await t.request("GET", `${base}/pages/${page.id}`)).json(),
    );
  }

  async function uploadMockup(name: string) {
    const response = await t.upload(`${base}/pages/${page.id}/mockups`, [
      { name, type: "image/png", data: makePng(4, 3) },
    ]);
    const [mockup] = (await response.json()) as { id: string }[];
    return mockup?.id ?? "";
  }

  const empty: StateCause = {
    type: "response",
    linkId: "l1",
    responseId: "r200",
    exampleId: "x2",
  };
  function states(mockupId = ""): PageState[] {
    return [
      {
        id: "s1",
        kind: "loading",
        name: "Loading items",
        description: "Grey rows.",
        causes: [{ type: "request", linkId: "l1" }],
        mockupIds: [],
      },
      {
        id: "s2",
        kind: "empty",
        name: "No items",
        description: "Offers to clear the filters.",
        causes: [empty],
        mockupIds: mockupId ? [mockupId] : [],
      },
      {
        id: "s3",
        kind: "error",
        name: "Can't delete",
        description: "",
        causes: [
          {
            type: "error",
            linkId: "l2",
            errorTypeId: deleteItem.responses[1]?.errors[0]?.errorTypeId ?? "",
            exampleId: null,
          },
        ],
        mockupIds: [],
      },
    ];
  }

  it("saves states with the page, in order", async () => {
    const mockupId = await uploadMockup("empty.png");

    const response = await patchPage({ states: states(mockupId) });

    expect(response.status).toBe(200);
    expect(pageSchema.parse(await response.json()).states).toEqual(
      states(mockupId),
    );
    expect((await getPage()).states).toEqual(states(mockupId));
  });

  it("keeps the states when a save leaves them out", async () => {
    await patchPage({ states: states() });

    // Clients from before page states send only the fields they know.
    expect((await patchPage({ name: "Items" })).status).toBe(200);
    expect(
      (
        await patchPage({
          description: "All items",
          endpoints: (await getPage()).endpoints,
        })
      ).status,
    ).toBe(200);

    expect((await getPage()).states).toEqual(states());
  });

  it("rejects causes that point at nothing, and mockups of other pages", async () => {
    const other = pageSchema.parse(
      await (
        await t.request("POST", `${base}/pages`, { name: "Other" })
      ).json(),
    );
    const response = await t.upload(`${base}/pages/${other.id}/mockups`, [
      { name: "other.png", type: "image/png", data: makePng(4, 3) },
    ]);
    const [otherMockup] = (await response.json()) as { id: string }[];
    const [loading, noItems, cantDelete] = states();
    if (!loading || !noItems || !cantDelete) {
      throw new Error("Three states");
    }

    const rejected = await patchPage({
      states: [
        loading,
        {
          ...noItems,
          causes: [{ ...empty, exampleId: "x-gone" }],
          mockupIds: [otherMockup?.id],
        },
        {
          ...cantDelete,
          causes: [
            {
              type: "error",
              linkId: "l1",
              errorTypeId: "et-gone",
              exampleId: null,
            },
          ],
        },
      ],
    });

    expect(rejected.status).toBe(400);
    expect(apiErrorSchema.parse(await rejected.json()).issues).toEqual([
      {
        path: "states.1.causes.0",
        message: "The 200 response of GET /items has no such example anymore",
      },
      { path: "states.1.mockupIds", message: "This page has no such mockup" },
      {
        path: "states.2.causes.0",
        message: "GET /items doesn't answer with this error type",
      },
    ]);
    expect((await getPage()).states).toEqual([]);
  });

  it("refuses to drop a call a saved state comes from", async () => {
    await patchPage({ states: states() });
    const [first] = (await getPage()).endpoints;

    // A client from before page states can't show field errors for them.
    const old = await patchPage({ endpoints: [first] });
    expect(old.status).toBe(409);
    const body = apiErrorSchema.parse(await old.json());
    expect(body.error).toBe(
      "Page states come from calls this change removes: Can't delete. Change those states first.",
    );
    expect(body.issues).toBeUndefined();

    // With the states, the issue goes on the cause.
    const current = await patchPage({ endpoints: [first], states: states() });
    expect(current.status).toBe(400);
    expect(apiErrorSchema.parse(await current.json()).issues).toEqual([
      {
        path: "states.2.causes.0",
        message: "This page doesn't make this call anymore",
      },
    ]);
    expect((await getPage()).endpoints).toHaveLength(2);
  });

  it("counts saves, and refuses one based on an older revision", async () => {
    const before = await getPage();

    const saved = await patchPage({
      description: "One",
      revision: before.revision,
    });
    expect(saved.status).toBe(200);
    expect(pageSchema.parse(await saved.json()).revision).toBe(
      before.revision + 1,
    );

    // Another tab saved since this one loaded the page.
    const stale = await patchPage({
      description: "Two",
      revision: before.revision,
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: `This page was saved again since revision ${before.revision}. It's at revision ${before.revision + 1} now: load it, or send that revision to save over it.`,
      revision: before.revision + 1,
    });
    expect((await getPage()).description).toBe("One");

    // Clients that don't send a revision save as before.
    expect((await patchPage({ description: "Three" })).status).toBe(200);
    expect(await getPage()).toMatchObject({
      description: "Three",
      revision: before.revision + 2,
    });
  });

  it("doesn't count changes to mockups as saves of the page", async () => {
    const before = await getPage();
    const mockupId = await uploadMockup("empty.png");
    const mockupUrl = `${base}/pages/${page.id}/mockups/${mockupId}`;

    await t.request("PATCH", mockupUrl, { caption: "Nothing found" });
    await t.request("DELETE", mockupUrl);

    expect((await getPage()).revision).toBe(before.revision);
  });

  it("drops mockups deleted since the page was loaded", async () => {
    const mockupId = await uploadMockup("empty.png");
    await patchPage({ states: states(mockupId) });
    await t.request("DELETE", `${base}/pages/${page.id}/mockups/${mockupId}`);

    // A window opened before the delete still lists the mockup.
    const response = await patchPage({ states: states(mockupId) });

    expect(response.status).toBe(200);
    expect((await getPage()).states).toEqual(states());
  });

  it("rejects two links with the same ID instead of failing", async () => {
    const response = await patchPage({
      endpoints: [
        { id: "l1", endpointId: listItems.id, trigger: "on_load", note: "" },
        { id: "l1", endpointId: deleteItem.id, trigger: "on_load", note: "" },
      ],
    });

    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await response.json()).issues).toEqual([
      { path: "endpoints.1.id", message: "Another link has this ID" },
    ]);
  });

  describe("when what a state comes from changes", () => {
    beforeEach(async () => {
      await patchPage({ states: states() });
    });

    const endpointUrl = (item: Endpoint, query = "") =>
      `${base}/endpoints/${item.id}${query}`;

    function withExamples(names: { id: string; name: string }[]) {
      const [ok] = listItems.responses;
      if (!ok?.body) {
        throw new Error("The 200 has a body");
      }
      return [
        {
          ...ok,
          body: {
            ...ok.body,
            examples: names.map(({ id, name }) => ({
              id,
              name,
              summary: "",
              value: { data: [] },
            })),
          },
        },
      ];
    }

    it("follows a renamed example", async () => {
      const response = await t.request("PATCH", endpointUrl(listItems), {
        responses: withExamples([
          { id: "x1", name: "first-page" },
          { id: "x2", name: "nothing-found" },
        ]),
      });

      expect(response.status).toBe(200);
      expect((await getPage()).states).toEqual(states());
    });

    it("refuses to remove it, naming the states, unless asked to detach them", async () => {
      const removeEmpty = {
        responses: withExamples([{ id: "x1", name: "first-page" }]),
      };

      const refused = await t.request(
        "PATCH",
        endpointUrl(listItems),
        removeEmpty,
      );
      expect(refused.status).toBe(409);
      expect(await refused.json()).toEqual({
        error:
          "Page states come from what this change removes: Stock list › No items. Change those states first, or remove it from them.",
        pageStates: [
          {
            pageId: page.id,
            pageName: "Stock list",
            stateId: "s2",
            stateName: "No items",
          },
        ],
      });
      const unchanged = endpointResponseFieldsSchema.parse(
        await (await t.request("GET", endpointUrl(listItems))).json(),
      );
      expect(unchanged.responses).toEqual(listItems.responses);

      const detached = await t.request(
        "PATCH",
        endpointUrl(listItems, "?detachStates=true"),
        removeEmpty,
      );
      expect(detached.status).toBe(200);
      const [loading, noItems, cantDelete] = states();
      expect((await getPage()).states).toEqual([
        loading,
        { ...noItems, causes: [] },
        cantDelete,
      ]);
    });

    it("removes an endpoint's calls from states when the endpoint is deleted", async () => {
      const response = await t.request("DELETE", endpointUrl(deleteItem));

      expect(response.status).toBe(204);
      const after = await getPage();
      expect(after.endpoints.map((link) => link.id)).toEqual(["l1"]);
      const [loading, noItems, cantDelete] = states();
      expect(after.states).toEqual([
        loading,
        noItems,
        { ...cantDelete, causes: [] },
      ]);
    });

    it("removes a deleted mockup from the states that show it", async () => {
      const mockupId = await uploadMockup("empty.png");
      await patchPage({ states: states(mockupId) });

      const response = await t.request(
        "DELETE",
        `${base}/pages/${page.id}/mockups/${mockupId}`,
      );

      expect(response.status).toBe(204);
      expect((await getPage()).states).toEqual(states());
    });
  });
});
