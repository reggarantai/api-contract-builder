import {
  type EndpointBody,
  type EndpointExample,
  type EndpointFields,
  type EndpointResponse,
  reasonPhrase,
} from "../../shared/endpoints";
import type { JsonSchema, JsonValue } from "../../shared/json-schema";
import {
  isObject,
  own,
  type Raw,
  type Segments,
  setOwn,
  shortened,
  shown,
} from "./context";
import type { Converter } from "./convert";
import { counted } from "./notices";

// Request bodies and responses: one media type each, named examples,
// headers, and descriptions the app needs.

/** The one media type the app keeps: JSON first, then other +json, then the first. */
/** Text for a response without a description, by its status. */
const STATUS_CLASSES: Record<string, string> = {
  "1": "Informational",
  "2": "Success",
  "3": "Redirection",
  "4": "Client error",
  "5": "Server error",
};

export function pickMediaType(
  c: Converter,
  content: Raw,
  at: Segments,
  label: string,
): string | undefined {
  // Read again each time a shared response is used, so counted each time.
  c.ctx.count(Object.keys(content).length);
  const types = Object.keys(content).filter(
    (type) => type.trim() !== "" && type.length <= 100,
  );
  const essence = (type: string) =>
    type.split(";")[0]?.trim().toLowerCase() ?? "";
  const chosen =
    types.find((type) => essence(type) === "application/json") ??
    types.find((type) => /\+json$/.test(essence(type))) ??
    types[0];
  const others = Object.keys(content).filter((type) => type !== chosen);
  if (others.length > 0) {
    c.note(
      "media-types",
      at,
      (count, examples) =>
        `A body has one media type in the app, so ${counted(count, "other one was", "others were")} left out: ${examples}`,
      `${others.map((type) => shown(type, 40)).join(", ")} (${label})`,
    );
  }
  return chosen;
}

/** A media type object: OpenAPI 3.2 lets one be a reference (components.mediaTypes). */
function followMedia(c: Converter, value: unknown, at: Segments) {
  return c.ctx.version === "3.2"
    ? c.follow(value, at)
    : { value, at, summary: undefined, description: undefined };
}

/** The value of an example: `dataValue` (3.2) when it's there, null too, else `value`. */
export function exampleValue(example: Raw): { value: unknown; key: string } {
  return own(example, "dataValue") !== undefined
    ? { value: own(example, "dataValue"), key: "dataValue" }
    : { value: own(example, "value"), key: "value" };
}

/** Why an example without a value has none. */
export function missingValue(example: Raw) {
  return own(example, "externalValue") !== undefined
    ? "its value is in another file, which the app never reads"
    : own(example, "serializedValue") !== undefined
      ? "it has only a serialized value"
      : "it has no value";
}

export function readBody(
  c: Converter,
  content: unknown,
  at: Segments,
  label: string,
): EndpointBody | null {
  if (content === undefined) return null;
  if (!isObject(content)) {
    c.ctx.refuse(at, "Expected an object of media types");
    return null;
  }
  const type = pickMediaType(c, content, at, label);
  if (type === undefined) return null;
  c.ctx.count();
  const followed = followMedia(c, content[type], [...at, type]);
  if (!followed) return null;
  const { value: media, at: mediaAt } = followed;
  if (!isObject(media)) {
    c.ctx.refuse(mediaAt, "Expected a media type object");
    return null;
  }
  for (const key of [
    "encoding",
    "itemSchema",
    "itemEncoding",
    "prefixEncoding",
  ]) {
    if (own(media, key) !== undefined) {
      c.note(
        `media-${key}`,
        [...mediaAt, key],
        (count, examples) =>
          `${key} isn't kept (${counted(count, "body", "bodies")}: ${examples})`,
        label,
      );
    }
  }
  c.rest(
    media,
    mediaAt,
    [
      "schema",
      "example",
      "examples",
      "encoding",
      "itemSchema",
      "itemEncoding",
      "prefixEncoding",
    ],
    "a media type",
  );
  const schemaValue = own(media, "schema");
  return {
    contentType: type.trim(),
    schema:
      schemaValue === undefined
        ? {}
        : c.schemas.slot(schemaValue, [...mediaAt, "schema"]),
    examples: readExamples(c, media, mediaAt, label),
  };
}

export function readExamples(
  c: Converter,
  media: Raw,
  at: Segments,
  label: string,
): EndpointExample[] {
  const out: EndpointExample[] = [];
  const names = new Set<string>();
  const add = (
    wanted: string,
    summary: string,
    value: JsonValue,
    here: Segments,
    catalog?: string,
  ) => {
    if (out.length === 20) {
      c.note(
        "examples-20",
        here,
        (count, examples) =>
          `A body keeps 20 examples, so ${counted(count, "more was", "more were")} left out: ${examples}`,
        label,
      );
      return undefined;
    }
    let name =
      wanted.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 64) || "example";
    const base = name;
    for (let n = 2; names.has(name); n++) {
      const suffix = `-${n}`;
      name = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    }
    names.add(name);
    if (name !== wanted) {
      c.note(
        "example-names",
        here,
        (count, examples) =>
          `${counted(count, "example was", "examples were")} renamed to names the app takes (Prism selects examples by name): ${examples}`,
        `${shown(wanted, 40)} → ${name} (${label})`,
      );
    }
    const example = { id: `x${out.length + 1}`, name, summary, value };
    out.push(example);
    c.exampleSources.set(example, {
      key: wanted,
      catalog: name === wanted ? catalog : undefined,
    });
    return example;
  };
  const examples = own(media, "examples");
  if (examples !== undefined) {
    if (!isObject(examples)) {
      c.ctx.refuse([...at, "examples"], "Expected an object of examples");
      return out;
    }
    for (const key of Object.keys(examples)) {
      c.ctx.count();
      const here = [...at, "examples", key];
      const followed = c.follow(examples[key], here);
      if (!followed) continue;
      const example = followed.value;
      if (!isObject(example)) {
        c.ctx.refuse(here, "Expected an example object");
        continue;
      }
      const { value: data, key: dataKey } = exampleValue(example);
      if (data === undefined) {
        c.note(
          "example-without-value",
          here,
          (count, examples_) =>
            `${counted(count, "example was", "examples were")} left out, since the app keeps example values: ${examples_}`,
          `${shown(key, 40)} (${label}: ${missingValue(example)})`,
        );
        continue;
      }
      const summaryValue =
        typeof followed.summary === "string"
          ? followed.summary
          : (c.ctx.text(example, "summary", followed.at) ?? "");
      let summary = summaryValue.trim();
      if (summary.length > 200) {
        c.note(
          "shortened",
          [...followed.at, "summary"],
          (count, examples_) =>
            `${counted(count, "text")} ${count === 1 ? "was" : "were"} longer than the app keeps, so ${count === 1 ? "it was" : "they were"} shortened: ${examples_}`,
          "an example summary (200 characters)",
        );
        summary = shortened(summary, 200);
      }
      const described =
        own(example, "description") !== undefined ||
        typeof followed.description === "string";
      c.rest(
        example,
        followed.at,
        [
          "summary",
          "description",
          "value",
          "externalValue",
          "dataValue",
          "serializedValue",
        ],
        "an example",
      );
      const raw = examples[key];
      const catalog =
        isObject(raw) &&
        Object.keys(raw).length === 1 &&
        own(raw, "$ref") === `#/components/examples/${key}`
          ? key
          : undefined;
      const made = add(
        key,
        summary,
        c.schemas.data(data, [...followed.at, dataKey], 0),
        here,
        catalog,
      );
      if (made && described) {
        c.describedExamples.set(made, {
          at: followed.at,
          shown: `${shown(key, 40)} (${label})`,
        });
      }
    }
    if (own(media, "example") !== undefined) {
      c.note(
        "example-and-examples",
        [...at, "example"],
        (count, examples_) =>
          `example was left out where examples is given too (${counted(count, "body", "bodies")}: ${examples_})`,
        label,
      );
    }
  } else if (own(media, "example") !== undefined) {
    add(
      "example",
      "",
      c.schemas.data(own(media, "example"), [...at, "example"], 0),
      [...at, "example"],
    );
  }
  return out;
}

export function readRequestBody(
  c: Converter,
  value: unknown,
  at: Segments,
  label: string,
): EndpointFields["requestBody"] {
  const followed = c.follow(value, at);
  if (!followed) return null;
  const body = followed.value;
  if (!isObject(body)) {
    c.ctx.refuse(at, "Expected a request body object");
    return null;
  }
  c.ctx.count();
  const content = readBody(
    c,
    own(body, "content"),
    [...followed.at, "content"],
    `${label} request`,
  );
  if (!content) {
    c.note(
      "body-without-content",
      followed.at,
      (count, examples) =>
        `${counted(count, "request body", "request bodies")} without a media type ${count === 1 ? "was" : "were"} left out: ${examples}`,
      label,
    );
    return null;
  }
  const descriptionText =
    typeof followed.description === "string"
      ? followed.description
      : (c.ctx.text(body, "description", followed.at) ?? "");
  let description = descriptionText.trim();
  if (description.length > 2000) {
    c.note(
      "shortened",
      [...followed.at, "description"],
      (count, examples) =>
        `${counted(count, "text")} ${count === 1 ? "was" : "were"} longer than the app keeps, so ${count === 1 ? "it was" : "they were"} shortened: ${examples}`,
      "a request body description (2,000 characters)",
    );
    description = shortened(description, 2000);
  }
  c.rest(
    body,
    followed.at,
    ["description", "content", "required"],
    "a request body",
  );
  return {
    ...content,
    required: own(body, "required") === true,
    description,
  };
}

export function readResponses(
  c: Converter,
  value: unknown,
  at: Segments,
  label: string,
): EndpointResponse[] {
  const out: EndpointResponse[] = [];
  if (value !== undefined && !isObject(value)) {
    c.ctx.refuse(at, "Expected an object of responses");
    return [fallbackResponse(c)];
  }
  const responses = isObject(value) ? value : {};
  const seen = new Set<string>();
  for (const key of Object.keys(responses)) {
    c.ctx.count();
    const here = [...at, key];
    if (key.startsWith("x-")) {
      c.rest({ [key]: responses[key] }, at, [], "responses");
      continue;
    }
    const status = /^[1-5]xx$/i.test(key) ? key.toUpperCase() : key;
    if (!/^(?:[1-5][0-9]{2}|[1-5]XX|default)$/.test(status)) {
      c.note(
        "bad-status",
        here,
        (count, examples) =>
          `${counted(count, "response")} with a status the app doesn't take ${count === 1 ? "was" : "were"} left out: ${examples}`,
        `${shown(key, 20)} (${label})`,
      );
      continue;
    }
    if (seen.has(status)) {
      c.note(
        "status-twice",
        here,
        (count, examples) =>
          `${counted(count, "response")} with a status given twice ${count === 1 ? "was" : "were"} left out: ${examples}`,
        `${key} (${label})`,
      );
      continue;
    }
    if (status !== key) {
      c.note(
        "status-case",
        here,
        (_count, examples) =>
          `Status ranges are written in capitals: ${examples}`,
        `${key} → ${status} (${label})`,
      );
    }
    if (out.length === 30) {
      c.note(
        "responses-30",
        here,
        (count, examples) =>
          `An endpoint keeps 30 responses, so ${counted(count, "more was", "more were")} left out: ${examples}`,
        label,
      );
      continue;
    }
    seen.add(status);
    const response = readResponse(c, status, responses[key], here, label);
    if (response) out.push(response);
  }
  if (out.length === 0) {
    c.note(
      "no-responses",
      at,
      (count, examples) =>
        `The app needs a response for each endpoint, so ${counted(count, "endpoint")} without one got a default response: ${examples}`,
      label,
    );
    out.push(fallbackResponse(c));
  }
  return out;
}

export function fallbackResponse(_c: Converter): EndpointResponse {
  return {
    id: "r-default",
    status: "default",
    description: "Response",
    headers: { type: "object", properties: {} },
    body: null,
    errors: [],
  };
}

export function readResponse(
  c: Converter,
  status: string,
  value: unknown,
  at: Segments,
  label: string,
): EndpointResponse | undefined {
  const followed = c.follow(value, at);
  if (!followed) return undefined;
  const response = followed.value;
  if (!isObject(response)) {
    c.ctx.refuse(at, "Expected a response object");
    return undefined;
  }
  c.ctx.count();
  const where = `${label} ${status}`;
  const given =
    typeof followed.description === "string"
      ? followed.description
      : c.ctx.text(response, "description", followed.at);
  let description = given?.trim() ?? "";
  if (description === "") {
    description =
      reasonPhrase(status) || STATUS_CLASSES[status[0] ?? ""] || "Response";
    c.note(
      "no-description",
      followed.at,
      (count, examples) =>
        `${counted(count, "response")} without a description got one from ${count === 1 ? "its" : "their"} status: ${examples}`,
      `${where}: ${description}`,
    );
  } else if (description.length > 500) {
    c.note(
      "shortened",
      [...followed.at, "description"],
      (count, examples) =>
        `${counted(count, "text")} ${count === 1 ? "was" : "were"} longer than the app keeps, so ${count === 1 ? "it was" : "they were"} shortened: ${examples}`,
      "a response description (500 characters)",
    );
    description = shortened(description, 500);
  }
  for (const key of ["links", "summary"]) {
    if (own(response, key) !== undefined) {
      c.note(
        `response-${key}`,
        [...followed.at, key],
        (count, examples) =>
          `${key === "links" ? "Links" : "Response summaries"} aren't kept (${counted(count, "response")}: ${examples})`,
        where,
      );
    }
  }
  c.rest(
    response,
    followed.at,
    ["description", "headers", "content", "links", "summary"],
    "a response",
  );
  return {
    id: `r-${status}`,
    status,
    description,
    headers: readHeaders(
      c,
      own(response, "headers"),
      [...followed.at, "headers"],
      where,
    ),
    body: readBody(
      c,
      own(response, "content"),
      [...followed.at, "content"],
      where,
    ),
    errors: [],
  };
}

export function readHeaders(
  c: Converter,
  value: unknown,
  at: Segments,
  where: string,
): JsonSchema {
  const properties: Record<string, JsonValue> = {};
  const required: string[] = [];
  if (value !== undefined && !isObject(value)) {
    c.ctx.refuse(at, "Expected an object of headers");
  }
  c.ctx.count();
  const names = new Set<string>();
  for (const name of isObject(value) ? Object.keys(value) : []) {
    c.ctx.count();
    const here = [...at, name];
    if (name.toLowerCase() === "content-type") {
      c.note(
        "content-type-header",
        here,
        (count, examples) =>
          `Content-Type response headers were left out, since OpenAPI ignores them (${counted(count, "response")}: ${examples})`,
        where,
      );
      continue;
    }
    if (names.has(name.toLowerCase())) {
      c.note(
        "header-twice",
        here,
        (count, examples) =>
          `Header names ignore case, so ${counted(count, "header")} named like another ${count === 1 ? "was" : "were"} left out: ${examples}`,
        `${shown(name, 60)} (${where})`,
      );
      continue;
    }
    names.add(name.toLowerCase());
    const followed = c.follow((value as Raw)[name], here);
    if (!followed || !isObject(followed.value)) {
      if (followed) c.ctx.refuse(here, "Expected a header object");
      continue;
    }
    const header = followed.value;
    setOwn(
      properties,
      name,
      readParameterSchema(
        c,
        { ...header, in: "header" },
        followed.at,
        where,
        name,
        followed.description,
      ),
    );
    if (own(header, "required") === true) {
      c.ctx.count();
      required.push(name);
    }
  }
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

/** A parameter or header as one property: its schema, with its description and examples. */
export function readParameterSchema(
  c: Converter,
  value: Raw,
  at: Segments,
  label: string,
  name: string,
  override?: unknown,
): JsonSchema {
  c.ctx.count();
  const shownName = shown(name, 60);
  let schemaValue = own(value, "schema");
  let schemaAt: Segments = [...at, "schema"];
  const content = own(value, "content");
  if (schemaValue === undefined && isObject(content)) {
    const types = Object.keys(content);
    c.ctx.count(types.length);
    const [type] = types;
    const followed =
      type === undefined
        ? undefined
        : followMedia(c, content[type], [...at, "content", type]);
    if (followed && isObject(followed.value)) {
      schemaValue = own(followed.value, "schema");
      schemaAt = [...followed.at, "schema"];
    }
    c.note(
      "parameter-content",
      [...at, "content"],
      (count, examples) =>
        `${counted(count, "parameter or header", "parameters and headers")} described by a media type ${count === 1 ? "keeps only its" : "keep only their"} schema: ${examples}`,
      `${shownName} (${label})`,
    );
  }
  const property =
    schemaValue === undefined ? {} : c.schemas.slot(schemaValue, schemaAt, 2);
  const description =
    typeof override === "string"
      ? override
      : c.ctx.text(value, "description", at);
  if (description !== undefined && description.trim() !== "") {
    if (
      typeof property.description === "string" &&
      property.description !== description
    ) {
      c.note(
        "schema-description",
        schemaAt,
        (count, examples) =>
          `The description of a parameter's or header's schema gave way to its own (${counted(count, "place")}: ${examples})`,
        `${shownName} (${label})`,
      );
    }
    property.description = description.trim();
  }
  if (own(value, "deprecated") === true) {
    property.deprecated = true;
  }
  const examples: JsonValue[] = Array.isArray(property.examples)
    ? [...property.examples]
    : [];
  if (own(value, "example") !== undefined) {
    examples.push(c.schemas.data(own(value, "example"), [...at, "example"], 3));
  }
  const named = own(value, "examples");
  if (Array.isArray(named)) {
    // A list, as JSON Schema writes examples: its values.
    c.ctx.count(named.length);
    named.forEach((item, index) => {
      examples.push(
        c.schemas.data(item, [...at, "examples", String(index)], 3),
      );
    });
    c.note(
      "parameter-examples-list",
      [...at, "examples"],
      (count, examples_) =>
        `${counted(count, "parameter or header", "parameters and headers")} gave examples as a list, as JSON Schema writes them, rather than named example objects: the values are ${count === 1 ? "its" : "their"} schema's examples (${examples_})`,
      `${shownName} (${label})`,
    );
  } else if (named !== undefined && !isObject(named)) {
    c.ctx.refuse([...at, "examples"], "Expected an object of examples");
  } else if (isObject(named)) {
    for (const key of Object.keys(named)) {
      c.ctx.count();
      const here = [...at, "examples", key];
      const followed = c.follow(named[key], here);
      if (!followed) continue;
      const example = followed.value;
      if (!isObject(example)) {
        c.note(
          "example-not-object",
          here,
          (count, examples_) =>
            `${counted(count, "example that isn't an example object was", "examples that aren't example objects were")} left out: ${examples_}`,
          `${shown(key, 40)} (${shownName}, ${label})`,
        );
        continue;
      }
      c.rest(
        example,
        followed.at,
        [
          "summary",
          "description",
          "value",
          "externalValue",
          "dataValue",
          "serializedValue",
        ],
        "an example",
      );
      const { value: data, key: dataKey } = exampleValue(example);
      if (data === undefined) {
        c.note(
          "example-without-value",
          here,
          (count, examples_) =>
            `${counted(count, "example was", "examples were")} left out, since the app keeps example values: ${examples_}`,
          `${shown(key, 40)} (${shownName}, ${label}: ${missingValue(example)})`,
        );
        continue;
      }
      examples.push(c.schemas.data(data, [...followed.at, dataKey], 3));
    }
    c.note(
      "parameter-examples",
      [...at, "examples"],
      (count, examples_) =>
        `Examples of parameters and headers keep their values, in the schema's examples; their names, summaries, and descriptions aren't kept (${counted(count, "place")}: ${examples_})`,
      `${shownName} (${label})`,
    );
  }
  if (examples.length > 0) {
    property.examples = examples;
  }
  const style = own(value, "style");
  const explode = own(value, "explode");
  const location = own(value, "in");
  const defaultStyle =
    location === "query" || location === "cookie" ? "form" : "simple";
  const odd =
    (style !== undefined && style !== defaultStyle) ||
    (explode !== undefined && explode !== (defaultStyle === "form")) ||
    own(value, "allowReserved") === true ||
    own(value, "allowEmptyValue") === true;
  if (odd) {
    c.note(
      "serialization",
      at,
      (count, examples_) =>
        `The app writes parameters with OpenAPI's default serialization, so style, explode, allowReserved, and allowEmptyValue aren't kept (${counted(count, "parameter")}: ${examples_})`,
      `${shownName} (${label})`,
    );
  }
  c.rest(
    value,
    at,
    [
      "name",
      "in",
      "description",
      "required",
      "deprecated",
      "allowEmptyValue",
      "style",
      "explode",
      "allowReserved",
      "schema",
      "example",
      "examples",
      "content",
    ],
    "a parameter or header",
  );
  return property;
}
