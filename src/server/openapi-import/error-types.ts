import type {
  EndpointExample,
  EndpointFields,
  EndpointResponse,
} from "../../shared/endpoints";
import {
  checkResponseErrors,
  type ErrorType,
  type ErrorTypeFields,
  isProblemDetails,
  statusMatches,
} from "../../shared/error-types";
import type { JsonSchema, JsonValue } from "../../shared/json-schema";
import { errorResponseParts } from "../export/error-responses";
import { exampleValue } from "./bodies";
import { isObject, own, type Segments, setOwn, shortened } from "./context";
import type { Converter } from "./convert";
import { counted } from "./notices";

// The app's export writes each error type once, in components.examples, and
// a response that uses it as `examples.<name>: {$ref}`; an endpoint's own
// examples of it are inline, told apart by their problem `type` (RFC 9457
// identifies a problem type by it). Reading that back is a guess, so it's
// kept only where the export, run on the result, writes exactly what the
// document has; everywhere else responses keep their bodies, every example
// copied in under its own name.

type Endpoint = EndpointFields & { id: string };

type Usage = {
  endpoint: Endpoint;
  response: EndpointResponse;
  example: EndpointExample;
  kind: "catalog" | "own";
};

type Candidate = {
  name: string;
  at: Segments;
  value: JsonValue;
  summary: string;
  description: string;
  usages: Usage[];
};

type Accepted = ErrorTypeFields & { id: string; candidate: Candidate };

const ONLY_WITH = /^Only with `([^`]+)`(?:: ([\s\S]*))?$/;

function isErrorStatus(status: string) {
  return /^[45](?:[0-9]{2}|XX)$/.test(status) || status === "default";
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function propertiesOf(schema: JsonSchema): Record<string, JsonValue> {
  return isObject(schema.properties)
    ? (schema.properties as Record<string, JsonValue>)
    : {};
}

function requiredOf(schema: JsonSchema): string[] {
  return Array.isArray(schema.required)
    ? (schema.required.filter((name) => typeof name === "string") as string[])
    : [];
}

export function reconstructErrorTypes(
  converter: Converter,
  endpoints: Endpoint[],
): (ErrorTypeFields & { id: string })[] {
  const { ctx } = converter;
  const components = own(ctx.doc, "components");
  const examples = isObject(components)
    ? own(components, "examples")
    : undefined;
  if (!isObject(examples)) {
    return [];
  }

  // --- Candidates: every component example with a value ------------------------
  const candidates = new Map<string, Candidate>();
  for (const name of Object.keys(examples)) {
    const at = ["components", "examples", name];
    const followed = converter.refs.follow(examples[name], at);
    if (!followed || !isObject(followed.value)) continue;
    const example = followed.value;
    const { value } = exampleValue(example);
    if (value === undefined) continue;
    candidates.set(name, {
      name,
      at,
      value: value as JsonValue,
      summary: (ctx.text(example, "summary", followed.at) ?? "").trim(),
      description: (ctx.text(example, "description", followed.at) ?? "").trim(),
      usages: [],
    });
  }
  // A problem type names one error type only when one example has it.
  const byType = new Map<string, string[]>();
  for (const candidate of candidates.values()) {
    const type = isObject(candidate.value) ? candidate.value.type : undefined;
    if (typeof type === "string" && type !== "about:blank") {
      const names = byType.get(type);
      if (names) names.push(candidate.name);
      else byType.set(type, [candidate.name]);
    }
  }

  // --- Usages -------------------------------------------------------------------
  const usageOf = new Map<EndpointExample, Usage & { candidate: Candidate }>();
  for (const endpoint of endpoints) {
    for (const response of endpoint.responses) {
      const { body } = response;
      if (!body || !isErrorStatus(response.status)) continue;
      for (const example of body.examples) {
        const source = converter.exampleSources.get(example);
        let candidate =
          source?.catalog === undefined
            ? undefined
            : candidates.get(source.catalog);
        let kind: Usage["kind"] = "catalog";
        if (
          !candidate &&
          isProblemDetails(body.contentType) &&
          isObject(example.value)
        ) {
          const type = example.value.type;
          const names = typeof type === "string" ? byType.get(type) : undefined;
          const status = example.value.status;
          if (
            names?.length === 1 &&
            (status === undefined ||
              (typeof status === "number" &&
                statusMatches(String(status), response.status)))
          ) {
            candidate = candidates.get(names[0] as string);
            kind = "own";
          }
        }
        if (!candidate) continue;
        const usage = { endpoint, response, example, kind };
        candidate.usages.push(usage);
        usageOf.set(example, { ...usage, candidate });
      }
    }
  }

  // --- Which candidates become error types ---------------------------------------
  const accepted: Accepted[] = [];
  const byCandidate = new Map<Candidate, Accepted>();
  const names = new Set<string>();
  const disagree: string[] = [];
  const caseClash: string[] = [];
  const typesOf = (response: EndpointResponse) =>
    new Set(
      (response.body?.examples ?? []).map(
        (example) => usageOf.get(example)?.candidate,
      ),
    );
  for (const candidate of candidates.values()) {
    const { usages } = candidate;
    if (usages.length === 0) {
      if (converter.isUsed("examples", candidate.name)) {
        converter.note(
          "shared-examples",
          candidate.at,
          (count, list) =>
            `Shared examples were copied into each response that uses them (${counted(count, "example")}: ${list})`,
          candidate.name,
        );
      }
      continue;
    }
    const exact = [
      ...new Set(
        usages
          .map((usage) => usage.response.status)
          .filter((status) => /^[45][0-9]{2}$/.test(status)),
      ),
    ];
    let status: string | undefined;
    if (exact.length === 1) {
      status = exact[0];
    } else if (exact.length === 0 && isObject(candidate.value)) {
      const given = candidate.value.status;
      if (
        typeof given === "number" &&
        Number.isInteger(given) &&
        given >= 400 &&
        given <= 599
      ) {
        status = String(given);
      }
    }
    const contentTypes = new Set(
      usages.map((usage) => usage.response.body?.contentType.toLowerCase()),
    );
    const alone = usages.filter((usage) => {
      const types = typesOf(usage.response);
      return types.size === 1 && types.has(candidate);
    });
    const source = (alone[0] ?? usages[0])?.response.body;
    if (
      status === undefined ||
      !usages.every((usage) =>
        statusMatches(status as string, usage.response.status),
      ) ||
      contentTypes.size !== 1 ||
      !source ||
      alone.some((usage) => !same(usage.response.body?.schema, source.schema))
    ) {
      disagree.push(candidate.name);
      continue;
    }
    if (
      !/^[A-Za-z0-9._-]{1,64}$/.test(candidate.name) ||
      names.has(candidate.name.toLowerCase())
    ) {
      caseClash.push(candidate.name);
      continue;
    }
    names.add(candidate.name.toLowerCase());
    let title = candidate.summary;
    if (
      title === "" &&
      isObject(candidate.value) &&
      typeof candidate.value.title === "string"
    ) {
      title = candidate.value.title.trim();
    }
    if (title === "") title = candidate.name;
    if (title.length > 200) title = shortened(title, 200);
    let description = candidate.description;
    if (description.length > 2000) {
      converter.note(
        "shortened",
        candidate.at,
        (count, list) =>
          `${counted(count, "text")} ${count === 1 ? "was" : "were"} longer than the app keeps, so ${count === 1 ? "it was" : "they were"} shortened: ${list}`,
        "an error type description (2,000 characters)",
      );
      description = shortened(description, 2000);
    }
    const errorType: Accepted = {
      id: `t${accepted.length + 1}`,
      name: candidate.name,
      status,
      title,
      description,
      headers: { type: "object", properties: {} },
      body: {
        contentType: source.contentType,
        schema: structuredClone(source.schema),
        example: structuredClone(candidate.value),
      },
      candidate,
    };
    accepted.push(errorType);
    byCandidate.set(candidate, errorType);
    converter.markUsed("examples", candidate.name);
  }
  if (disagree.length > 0) {
    converter.note(
      "error-types-disagree",
      ["components", "examples"],
      () =>
        `${counted(disagree.length, "component example")} couldn't be error types, since the responses that use them disagree on status, media type, or schema, or don't say a status; they're copied into those responses: ${disagree.slice(0, 5).join(", ")}${disagree.length > 5 ? ", …" : ""}`,
    );
  }
  if (caseClash.length > 0) {
    converter.note(
      "error-types-case",
      ["components", "examples"],
      () =>
        `Error type names must differ in more than case, so ${counted(caseClash.length, "example stays", "examples stay")} copied into the responses that use ${caseClash.length === 1 ? "it" : "them"}: ${caseClash.slice(0, 5).join(", ")}`,
    );
  }

  // --- Headers the export merged in, where that's certain ------------------------
  const typesIn = (response: EndpointResponse) =>
    [...typesOf(response)].map((candidate) =>
      candidate ? byCandidate.get(candidate) : undefined,
    );
  /** The required headers of a response, as a set, worked out once. */
  const requiredSets = new Map<EndpointResponse, Set<string>>();
  const requiredIn = (response: EndpointResponse) => {
    let names = requiredSets.get(response);
    if (!names) {
      names = new Set(requiredOf(response.headers));
      requiredSets.set(response, names);
    }
    return names;
  };
  for (const errorType of accepted) {
    const usages = errorType.candidate.usages.filter((usage) =>
      typesIn(usage.response).every(Boolean),
    );
    const responses = [...new Set(usages.map((usage) => usage.response))];
    const solo = responses.filter((response) => typesIn(response).length === 1);
    const properties: Record<string, JsonValue> = {};
    const required: string[] = [];
    if (solo.length >= 2) {
      const [first] = solo;
      for (const [name, header] of Object.entries(
        propertiesOf((first as EndpointResponse).headers),
      )) {
        const description = isObject(header) ? header.description : undefined;
        if (typeof description === "string" && ONLY_WITH.test(description))
          continue;
        const isRequired = requiredIn(first as EndpointResponse).has(name);
        if (
          solo.every(
            (response) =>
              same(propertiesOf(response.headers)[name], header) &&
              requiredIn(response).has(name) === isRequired,
          )
        ) {
          setOwn(properties, name, structuredClone(header));
          if (isRequired) required.push(name);
        }
      }
    }
    for (const response of responses) {
      if (typesIn(response).length < 2) continue;
      for (const [name, header] of Object.entries(
        propertiesOf(response.headers),
      )) {
        if (!isObject(header) || typeof header.description !== "string")
          continue;
        const match = ONLY_WITH.exec(header.description);
        if (!match || match[1] !== errorType.name) continue;
        const restored: Record<string, JsonValue> = {
          ...(header as Record<string, JsonValue>),
        };
        if (match[2] === undefined) {
          delete restored.description;
        } else {
          restored.description = match[2];
        }
        if (
          Object.hasOwn(properties, name) &&
          !same(properties[name], restored)
        ) {
          continue;
        }
        setOwn(properties, name, restored);
      }
    }
    errorType.headers = {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  // --- Each response, if the export writes it back exactly ---------------------
  const asErrorType = (item: Accepted): ErrorType => ({
    id: item.id,
    projectId: "",
    name: item.name,
    status: item.status,
    title: item.title,
    description: item.description,
    headers: item.headers,
    body: item.body,
    endpointIds: [],
    revision: 0,
    createdAt: "",
    updatedAt: "",
  });

  const typesById = new Map(
    accepted.map((item) => [item.id, asErrorType(item)]),
  );
  // By ID, made once for every response's check.
  const placements = new Map(
    accepted.map(({ id, name, status }) => [id, { id, name, status }]),
  );

  type Plan = { endpoint: Endpoint; index: number; response: EndpointResponse };
  /** The response with error types, or why the export wouldn't write it the same. */
  const plan = (
    endpoint: Endpoint,
    index: number,
    response: EndpointResponse,
  ): Plan | "headers" | "other" => {
    const { body } = response;
    if (!body || body.examples.length === 0) return "other";
    const groups: {
      type: Accepted;
      examples: EndpointExample[];
      catalog: boolean;
    }[] = [];
    for (const example of body.examples) {
      const usage = usageOf.get(example);
      const type = usage ? byCandidate.get(usage.candidate) : undefined;
      if (!usage || !type) return "other";
      const last = groups.at(-1);
      if (last && last.type === type) {
        if (usage.kind === "catalog" || last.catalog) return "other";
        last.examples.push(example);
        continue;
      }
      if (groups.some((group) => group.type === type)) return "other";
      groups.push({
        type,
        examples: usage.kind === "own" ? [example] : [],
        catalog: usage.kind === "catalog",
      });
    }
    const typeHeaders = new Set(
      groups.flatMap((group) =>
        Object.keys(propertiesOf(group.type.headers)).map((name) =>
          name.toLowerCase(),
        ),
      ),
    );
    const ownProperties: Record<string, JsonValue> = {};
    for (const [name, header] of Object.entries(
      propertiesOf(response.headers),
    )) {
      if (!typeHeaders.has(name.toLowerCase()))
        setOwn(ownProperties, name, header);
    }
    const ownRequired = requiredOf(response.headers).filter((name) =>
      Object.hasOwn(ownProperties, name),
    );
    const next: EndpointResponse = {
      ...response,
      headers: {
        ...response.headers,
        properties: ownProperties,
        ...(ownRequired.length > 0 ? { required: ownRequired } : {}),
      },
      body: null,
      errors: groups.map((group) => ({
        errorTypeId: group.type.id,
        examples: group.examples,
      })),
    };
    if (ownRequired.length === 0) delete next.headers.required;
    const parts = errorResponseParts(next, typesById);
    const [content] = parts.contents;
    const written =
      parts.contents.length === 1 &&
      content !== undefined &&
      content.contentType === body.contentType &&
      same(content.schema, body.schema) &&
      content.examples.length === body.examples.length &&
      content.examples.every((example, at) => {
        const original = body.examples[at] as EndpointExample;
        const usage = usageOf.get(original);
        return example.own === null
          ? usage?.kind === "catalog" && example.name === original.name
          : usage?.kind === "own" &&
              example.name === original.name &&
              example.own.summary === original.summary &&
              same(example.own.value, original.value);
      });
    if (!written) return "other";
    const responses = endpoint.responses.map((item, at) =>
      at === index ? next : item,
    );
    const placed = checkResponseErrors({ responses }, placements);
    if (placed.some((issue) => issue.path.startsWith(`responses.${index}.`)))
      return "other";
    if (!same(parts.headers, response.headers)) return "headers";
    return { endpoint, index, response: next };
  };

  // Headers given to error types only where every response that uses
  // them still comes out the same; otherwise they stay on the responses.
  // Taking a type's headers away changes only the responses that use it,
  // so only those are planned again: each at most once a type it has.
  type Slot = { endpoint: Endpoint; index: number; types: Accepted[] };
  const slots: Slot[] = [];
  const slotsOf = new Map<Accepted, Slot[]>();
  for (const endpoint of endpoints) {
    endpoint.responses.forEach((response, index) => {
      if (!isErrorStatus(response.status)) return;
      const types = typesIn(response);
      if (types.length === 0 || !types.every(Boolean)) return;
      const slot: Slot = { endpoint, index, types: types as Accepted[] };
      slots.push(slot);
      for (const type of new Set(slot.types)) {
        const list = slotsOf.get(type);
        if (list) list.push(slot);
        else slotsOf.set(type, [slot]);
      }
    });
  }
  const made = new Map<Slot, ReturnType<typeof plan>>();
  for (let pending = slots; pending.length > 0; ) {
    const failedTypes = new Set<Accepted>();
    for (const slot of pending) {
      const result = plan(
        slot.endpoint,
        slot.index,
        slot.endpoint.responses[slot.index] as EndpointResponse,
      );
      made.set(slot, result);
      if (result === "headers") {
        // Only the headers differ: the error types keep none of them.
        for (const type of slot.types) {
          if (Object.keys(propertiesOf(type.headers)).length > 0)
            failedTypes.add(type);
        }
      }
    }
    for (const type of failedTypes) {
      type.headers = { type: "object", properties: {} };
      typesById.set(type.id, asErrorType(type));
      converter.note(
        "error-type-headers",
        type.candidate.at,
        (count, list) =>
          `The headers of ${counted(count, "error type")} stay on the responses that send them, since the export wouldn't write those responses the same otherwise: ${list}`,
        type.name,
      );
    }
    pending = [
      ...new Set([...failedTypes].flatMap((type) => slotsOf.get(type) ?? [])),
    ];
  }
  for (const slot of slots) {
    const result = made.get(slot);
    if (typeof result === "object") {
      slot.endpoint.responses[slot.index] = result.response;
    }
  }

  return accepted.map(({ candidate: _candidate, ...errorType }) => errorType);
}
