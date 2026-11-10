import type { EndpointFields } from "../../shared/endpoints";
import { PAGE_TRIGGERS, type PageEndpointLink } from "../../shared/pages";
import { SLUG_MAX_LENGTH, SLUG_PATTERN, slugify } from "../../shared/slug";
import type { ProjectFilePage } from "../project-file/format";
import { isObject, own, type Raw, Stop, shortened, shown } from "./context";
import type { Converter } from "./convert";
import { exportTooLarge } from "./exports";
import { counted, listed } from "./notices";
import { OPENAPI_LIMITS } from "./read";
import { UniqueNames } from "./unique-names";

// Pages exist in OpenAPI only as this app writes them: a tag per page, and
// x-pages on each operation a page calls ({ page, slug, trigger, note }). A
// document this app wrote gets its pages and their links back; acceptance
// criteria, mockups, and states aren't in OpenAPI. Other documents' tags
// group operations, which isn't what a page is, so their endpoints start
// without pages, as the Export tab then says.

type Endpoint = EndpointFields & { id: string };

const TRIGGERS = new Set<string>(PAGE_TRIGGERS);

type Entry = {
  page: string;
  slug: string;
  trigger: PageEndpointLink["trigger"];
  note: string;
};

/** The most characters of a link's note the app keeps. */
const NOTE_LENGTH = 500;

function entriesOf(value: unknown): {
  entries: Entry[];
  bad: number;
  long: number;
} {
  if (!Array.isArray(value)) {
    return { entries: [], bad: value === undefined ? 0 : 1, long: 0 };
  }
  const entries: Entry[] = [];
  let bad = 0;
  let long = 0;
  for (const item of value) {
    const page = isObject(item) ? own(item, "page") : undefined;
    const slug = isObject(item) ? own(item, "slug") : undefined;
    const trigger = isObject(item) ? own(item, "trigger") : undefined;
    const note = isObject(item) ? own(item, "note") : undefined;
    if (
      typeof page !== "string" ||
      page.trim() === "" ||
      page.trim().length > 100 ||
      typeof slug !== "string" ||
      !SLUG_PATTERN.test(slug) ||
      slug.length > 64 ||
      typeof trigger !== "string" ||
      !TRIGGERS.has(trigger) ||
      (note !== undefined && typeof note !== "string")
    ) {
      bad++;
      continue;
    }
    let text = typeof note === "string" ? note.trim() : "";
    if (text.length > NOTE_LENGTH) {
      long++;
      text = shortened(text, NOTE_LENGTH);
    }
    entries.push({
      page: page.trim(),
      slug,
      trigger: trigger as Entry["trigger"],
      note: text,
    });
  }
  return { entries, bad, long };
}

export function buildPages(
  converter: Converter,
  endpoints: Endpoint[],
): ProjectFilePage[] {
  const { ctx } = converter;
  const tagsValue = own(ctx.doc, "tags");
  const tags = Array.isArray(tagsValue) ? tagsValue : [];
  if (tagsValue !== undefined && !Array.isArray(tagsValue)) {
    ctx.refuse(["tags"], "Expected a list of tags");
  }
  const operations = endpoints.map((endpoint) => ({
    endpoint,
    operation: converter.operationSources.get(endpoint.id) ?? {},
  }));
  const written =
    operations.some(
      ({ operation }) => own(operation, "x-pages") !== undefined,
    ) ||
    (operations.length > 0 &&
      operations.every(({ operation }) => {
        const status = own(operation, "x-status");
        return status === "draft" || status === "review" || status === "agreed";
      }));
  /** The tags of each operation, read once however many endpoints it makes (a path item reference). */
  const operationTags = new Map<Raw, string[]>();
  for (const { operation } of operations) {
    if (operationTags.has(operation)) continue;
    const list = own(operation, "tags");
    operationTags.set(
      operation,
      Array.isArray(list)
        ? list.filter((name): name is string => typeof name === "string")
        : [],
    );
  }
  if (!written) {
    // Tags of the document and of its operations, each name once.
    const names = new Set<string>();
    for (const tag of tags) {
      if (isObject(tag) && typeof tag.name === "string") names.add(tag.name);
    }
    for (const list of operationTags.values()) {
      for (const name of list) names.add(name);
    }
    if (names.size > 0) {
      const first = [...names].slice(0, 3).map((name) => shown(name, 40));
      // The document's tags, or the first operation's.
      const tagged = operations.find(
        ({ operation }) => (operationTags.get(operation) ?? []).length > 0,
      );
      converter.note(
        "tags",
        tags.length > 0 || !tagged
          ? ["tags"]
          : [...(converter.operationAt.get(tagged.endpoint.id) ?? []), "tags"],
        () =>
          `${counted(names.size, "tag")} (${listed(first, names.size)}) ${names.size === 1 ? "wasn't" : "weren't"} imported: OpenAPI tags group operations, and a project's pages are the screens that call them, so the endpoints start without pages. The Export tab lists them as unused until pages link them.`,
      );
    }
    return [];
  }

  const read = operations.map(({ endpoint, operation }) => {
    const at = converter.operationAt.get(endpoint.id) ?? [];
    // A shared operation's entries are read for each endpoint: counted.
    const given = own(operation, "x-pages");
    ctx.count(Array.isArray(given) ? given.length : 1);
    const found = entriesOf(given);
    // A tag this app's export writes names a page that links the operation.
    const linked = new Set(
      found.entries.flatMap((entry) => [
        entry.page,
        `${entry.page} (${entry.slug})`,
      ]),
    );
    for (const name of operationTags.get(operation) ?? []) {
      if (linked.has(name)) continue;
      converter.note(
        "operation-tags",
        [...at, "tags"],
        (count, examples) =>
          `Tags of operations that no x-pages entry of theirs links aren't kept, since pages are the screens that call endpoints (${counted(count, "operation")}: ${examples})`,
        `${endpoint.method} ${endpoint.path}`,
      );
      break;
    }
    return { endpoint, ...found, at: [...at, "x-pages"] };
  });
  const bad = read.reduce((total, item) => total + item.bad, 0);
  if (bad > 0) {
    const first = read.find((item) => item.bad > 0);
    converter.note(
      "x-pages",
      first?.at ?? [],
      () =>
        `${counted(bad, "x-pages entry", "x-pages entries")} the app can't take (each needs a page, a slug, and a trigger: ${PAGE_TRIGGERS.join(", ")}) ${bad === 1 ? "was" : "were"} left out`,
    );
  }
  const long = read.reduce((total, item) => total + item.long, 0);
  if (long > 0) {
    const first = read.find((item) => item.long > 0);
    converter.note(
      "x-pages-notes",
      first?.at ?? [],
      () =>
        `${counted(long, "x-pages note was", "x-pages notes were")} longer than the app keeps (${NOTE_LENGTH.toLocaleString("en-US")} characters), so ${long === 1 ? "it was" : "they were"} shortened`,
    );
  }

  type Built = ProjectFilePage & { links: PageEndpointLink[] };
  const pages: Built[] = [];
  // As uniqueSlug makes them, in linear time however alike the names.
  const slugs = new UniqueNames({
    max: SLUG_MAX_LENGTH,
    separator: "-",
    cut: (text, length) => text.slice(0, length).replace(/-+$/, ""),
  });
  const bySlug = new Map<string, Built>();
  const byName = new Map<string, Built>();
  const add = (name: string, wanted: string, description: string) => {
    const slug = slugs.claim(wanted || "page");
    const page: Built = {
      id: `p${pages.length + 1}`,
      name,
      slug,
      description,
      acceptanceCriteria: "",
      endpoints: [],
      mockups: [],
      states: [],
      links: [],
    };
    pages.push(page);
    bySlug.set(slug, page);
    if (!byName.has(name)) byName.set(name, page);
    return page;
  };
  // What x-pages entries say about each page, to read tags by.
  const entrySlugs = new Set<string>();
  const firstSlugs = new Map<string, string>();
  for (const item of read) {
    for (const entry of item.entries) {
      entrySlugs.add(`${entry.page}\u0000${entry.slug}`);
      if (!firstSlugs.has(entry.page)) firstSlugs.set(entry.page, entry.slug);
    }
  }
  tags.forEach((tag, index) => {
    const at = ["tags", String(index)];
    if (!isObject(tag) || typeof tag.name !== "string") {
      ctx.refuse(at, "Expected a tag with a name");
      return;
    }
    const tagName = tag.name.trim();
    let name = tagName;
    let slug: string | undefined;
    // This app names a tag "Name (slug)" when two pages share a name.
    const open = tagName.lastIndexOf(" (");
    if (open > 0 && tagName.endsWith(")")) {
      const base = tagName.slice(0, open);
      const inner = tagName.slice(open + 2, -1);
      if (entrySlugs.has(`${base}\u0000${inner}`)) {
        name = base;
        slug = inner;
      }
    }
    slug ??= firstSlugs.get(name) ?? slugify(name);
    if (name === "") {
      ctx.refuse([...at, "name"], "A tag's name can't be empty");
      return;
    }
    let description = (ctx.text(tag, "description", at) ?? "").trim();
    if (description.length > 20_000) {
      converter.note(
        "shortened",
        [...at, "description"],
        (count, examples) =>
          `${counted(count, "text")} ${count === 1 ? "was" : "were"} longer than the app keeps, so ${count === 1 ? "it was" : "they were"} shortened: ${examples}`,
        "a page description (20,000 characters)",
      );
      description = shortened(description, 20_000);
    }
    converter.rest(tag, at, ["name", "description"], "a tag");
    add(name.length > 100 ? shortened(name, 100) : name, slug, description);
  });

  let dropped = 0;
  let over = 0;
  // Each link writes its page's name and slug into the operation it links
  // (tags and x-pages): stopped here, before the export is built to measure.
  let linkText = 0;
  for (const { endpoint, entries: links } of read) {
    for (const entry of links) {
      const page =
        bySlug.get(entry.slug) ??
        byName.get(entry.page) ??
        add(entry.page, entry.slug, "");
      if (
        page.links.some(
          (link) =>
            link.endpointId === endpoint.id && link.trigger === entry.trigger,
        )
      ) {
        dropped++;
        continue;
      }
      if (page.links.length === 50) {
        over++;
        continue;
      }
      page.links.push({
        id: `l${page.links.length + 1}`,
        endpointId: endpoint.id,
        trigger: entry.trigger,
        note: entry.note,
      });
      linkText +=
        2 * page.name.length + page.slug.length + entry.note.length + 40;
      if (linkText > OPENAPI_LIMITS.maxExportText) {
        throw new Stop(exportTooLarge("openapi"));
      }
    }
  }
  if (dropped > 0) {
    converter.note(
      "links-twice",
      [],
      () =>
        `A page links an endpoint once per trigger, so ${counted(dropped, "x-pages entry", "x-pages entries")} that repeated one ${dropped === 1 ? "was" : "were"} left out`,
    );
  }
  if (over > 0) {
    converter.note(
      "links-50",
      [],
      () =>
        `A page has at most 50 links, so ${counted(over, "more was", "more were")} left out`,
    );
  }
  return pages.map(({ links, ...page }) => ({ ...page, endpoints: links }));
}
