import { describe, expect, it } from "vitest";
import { convert, doc31, type Loose } from "./test-convert";

const ok = { "200": { description: "OK" } };

function page(converted: ReturnType<typeof convert>, slug: string) {
  const found = converted.document.pages.find((item) => item.slug === slug);
  expect(found, slug).toBeDefined();
  const labels = new Map(
    converted.document.endpoints.map((item) => [
      item.id,
      `${item.method} ${item.path}`,
    ]),
  );
  return {
    ...(found as NonNullable<typeof found>),
    links: (found?.endpoints ?? []).map((link) => ({
      endpoint: labels.get(link.endpointId),
      trigger: link.trigger,
      note: link.note,
    })),
  };
}

describe("pages, from what this app writes", () => {
  it("makes each tag a page and each x-pages entry a link, when operations carry x-pages", () => {
    const converted = convert(
      doc31({
        tags: [
          { name: "Stock list", description: "All items." },
          { name: "Login" },
          { name: "Login (login-2)", description: "The other login." },
          { name: "Empty page" },
        ],
        paths: {
          "/items": {
            get: {
              tags: ["Stock list"],
              "x-status": "draft",
              "x-pages": [
                { page: "Stock list", slug: "stock-list", trigger: "on_load" },
              ],
              responses: ok,
            },
          },
          "/auth/login": {
            post: {
              tags: ["Login", "Login (login-2)"],
              "x-status": "agreed",
              "x-pages": [
                {
                  page: "Login",
                  slug: "login",
                  trigger: "on_submit",
                  note: "The form",
                },
                { page: "Login", slug: "login-2", trigger: "on_submit" },
                { page: "Stock list", slug: "stock-list", trigger: "other" },
              ],
              responses: ok,
            },
          },
        },
      }),
    );
    expect(
      converted.document.pages.map((item) => [item.name, item.slug]),
    ).toEqual([
      ["Stock list", "stock-list"],
      ["Login", "login"],
      ["Login", "login-2"],
      ["Empty page", "empty-page"],
    ]);
    expect(page(converted, "stock-list")).toMatchObject({
      description: "All items.",
      acceptanceCriteria: "",
      states: [],
      mockups: [],
      links: [
        { endpoint: "GET /items", trigger: "on_load", note: "" },
        { endpoint: "POST /auth/login", trigger: "other", note: "" },
      ],
    });
    expect(page(converted, "login").links).toEqual([
      { endpoint: "POST /auth/login", trigger: "on_submit", note: "The form" },
    ]);
    expect(page(converted, "login-2")).toMatchObject({
      description: "The other login.",
    });
    expect(converted.messages).not.toContainEqual(
      expect.stringMatching(/tags/i),
    );
  });

  it("makes tags pages when every operation has this app's x-status, even with no links", () => {
    const converted = convert(
      doc31({
        tags: [{ name: "Home" }],
        paths: { "/a": { get: { "x-status": "review", responses: ok } } },
      }),
    );
    expect(converted.document.pages.map((item) => item.name)).toEqual(["Home"]);
  });

  it("doesn't make other documents' tags pages: endpoints start without pages", () => {
    const converted = convert(
      doc31({
        tags: [{ name: "pets" }, { name: "store" }],
        paths: { "/pets": { get: { tags: ["pets"], responses: ok } } },
      }),
    );
    expect(converted.document.pages).toEqual([]);
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/2 tags.*pets.*store.*pages.*start without/s),
    );
  });

  it("skips x-pages entries the app can't take, saying which", () => {
    const converted = convert(
      doc31({
        tags: [{ name: "A" }],
        paths: {
          "/a": {
            get: {
              "x-pages": [
                { page: "A", slug: "a", trigger: "on_load" },
                { page: "A", slug: "a", trigger: "on_load" },
                { page: "A", slug: "a", trigger: "sometimes" },
                "nonsense",
              ],
              responses: ok,
            },
          },
        },
      }),
    );
    expect(page(converted, "a").links).toHaveLength(1);
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/x-pages.*left out/s),
    );
  });

  it("keeps at most 50 links on a page", () => {
    const paths: Loose = {};
    for (let index = 0; index < 55; index++) {
      paths[`/p${index}`] = {
        get: {
          "x-pages": [{ page: "Busy", slug: "busy", trigger: "on_load" }],
          responses: ok,
        },
      };
    }
    const converted = convert(doc31({ tags: [{ name: "Busy" }], paths }));
    expect(page(converted, "busy").links).toHaveLength(50);
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/50 links/),
    );
  });
});

describe("tags and notes that pages don't take", () => {
  it("says the tags of operations weren't imported when the document only tags operations", () => {
    const converted = convert(
      doc31({
        paths: {
          "/a": { get: { tags: ["Pets", "Stores"], responses: ok } },
          "/b": { get: { tags: ["Pets"], responses: ok } },
        },
      }),
    );
    expect(converted.document.pages).toEqual([]);
    expect(converted.messages.join("\n")).toMatch(
      /2 tags \(Pets and Stores\) weren't imported: OpenAPI tags group operations/,
    );
  });

  it("says which operations keep tags no x-pages entry of theirs links, and shortens long notes, saying so", () => {
    const converted = convert(
      doc31({
        tags: [{ name: "Login" }],
        paths: {
          "/a": {
            get: {
              tags: ["Login", "Admin"],
              "x-pages": [
                {
                  page: "Login",
                  slug: "login",
                  trigger: "on_load",
                  note: "n".repeat(600),
                },
              ],
              responses: ok,
            },
          },
        },
      }),
    );
    expect(page(converted, "login").links).toEqual([
      { endpoint: "GET /a", trigger: "on_load", note: `${"n".repeat(499)}…` },
    ]);
    const messages = converted.messages.join("\n");
    expect(messages).toMatch(
      /Tags of operations that no x-pages entry of theirs links aren't kept, since pages are the screens that call endpoints \(1 operation: GET \/a\)/,
    );
    expect(messages).toMatch(
      /1 x-pages note was longer than the app keeps \(500 characters\), so it was shortened/,
    );
  });
});

describe("the tags notice", () => {
  it("points at the first operation's tags when only operations have them", () => {
    const converted = convert(
      doc31({
        paths: {
          "/a": { get: { responses: ok } },
          "/b": { get: { tags: ["Pets"], responses: ok } },
        },
      }),
    );
    const notice = converted.notices.find((item) =>
      item.message.includes("tag (Pets) wasn't imported"),
    );
    expect(notice?.path).toBe("/paths/~1b/get/tags");
  });
});
