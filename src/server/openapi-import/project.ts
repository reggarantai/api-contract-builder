import type { EndpointSecurity } from "../../shared/endpoints";
import type { SecurityScheme, Server } from "../../shared/projects";
import { slugify } from "../../shared/slug";
import {
  isObject,
  own,
  type Raw,
  type Segments,
  shortened,
  shown,
  shownValue,
} from "./context";
import type { Converter } from "./convert";
import { counted } from "./notices";
import { shownPointer } from "./pointer";

// A project's settings from an OpenAPI document: info, servers, security
// schemes, and what security requirements become.

export function readProject(c: Converter) {
  const doc = c.ctx.doc;
  const info = own(doc, "info");
  const infoAt = ["info"];
  const infoObject = isObject(info) ? info : {};
  if (!isObject(info)) {
    c.ctx.refuse(infoAt, "Expected an object with the API's title and version");
  }
  let name = c.text(infoObject, "title", infoAt, 100, "info.title");
  if (name === "") {
    name = "Imported API";
    c.note(
      "no-title",
      infoAt,
      () =>
        "The document has no info.title, so the project is called Imported API",
    );
  }
  const versionValue = own(infoObject, "version");
  let apiVersion = c.text(infoObject, "version", infoAt, 50, "info.version");
  if (apiVersion === "") {
    apiVersion = "1.0.0";
    c.note(
      "no-version",
      infoAt,
      () => "The document has no info.version, so the API version is 1.0.0",
    );
  } else if (typeof versionValue === "number") {
    c.note(
      "version-number",
      [...infoAt, "version"],
      () =>
        `info.version should be text, like "1.0.0"; the number is taken as ${apiVersion}`,
    );
  }
  const description = c.text(
    infoObject,
    "description",
    infoAt,
    2000,
    "info.description",
  );
  for (const key of ["summary", "termsOfService", "contact", "license"]) {
    if (own(infoObject, key) !== undefined) {
      c.note(
        "info-fields",
        [...infoAt, key],
        (_count, examples) =>
          `The project has no place for these parts of info, so they aren't kept: ${examples}`,
        key,
      );
    }
  }
  c.rest(
    infoObject,
    infoAt,
    [
      "title",
      "version",
      "description",
      "summary",
      "termsOfService",
      "contact",
      "license",
    ],
    "info",
  );

  return {
    id: "project",
    name,
    slug: slugify(name) || "project",
    description,
    apiVersion,
    servers: readServers(c),
    securitySchemes: readSecuritySchemes(c),
    defaultSecuritySchemeId: null as string | null,
  };
}

export function readServers(c: Converter): Server[] {
  const servers = own(c.ctx.doc, "servers");
  if (servers === undefined) return [];
  if (!Array.isArray(servers)) {
    c.ctx.refuse(["servers"], "Expected a list of servers");
    return [];
  }
  const out: Server[] = [];
  servers.forEach((server, index) => {
    c.ctx.count();
    const at = ["servers", String(index)];
    if (!isObject(server)) {
      c.ctx.refuse(at, "Expected a server object");
      return;
    }
    if (out.length === 20) {
      c.note(
        "servers-20",
        at,
        (count) =>
          `The app keeps 20 servers, so ${counted(count, "more was", "more were")} left out`,
      );
      return;
    }
    let url = c.ctx.text(server, "url", at)?.trim() ?? "";
    const variables = own(server, "variables");
    if (isObject(variables)) {
      const lost: string[] = [];
      url = url.replace(/\{([^{}]+)\}/g, (whole, variable: string) => {
        const definition = isObject(variables[variable])
          ? (variables[variable] as Raw)
          : undefined;
        const value = definition ? own(definition, "default") : undefined;
        if (typeof value !== "string") return whole;
        const others = definition ? own(definition, "enum") : undefined;
        if (Array.isArray(others) && others.length > 1) {
          const rest = others.filter((item) => item !== value);
          lost.push(
            `${shown(variable, 40)}: ${rest
              .slice(0, 5)
              .map((item) => shownValue(item, 40))
              .join(", ")}${rest.length > 5 ? ", …" : ""}`,
          );
        }
        return value;
      });
      c.note(
        "server-variables",
        [...at, "variables"],
        (_count, examples) =>
          `Server URL variables were replaced with their defaults, since a project's servers are plain URLs${examples ? `; other values left out: ${examples}` : ""}`,
        lost.length > 0 ? lost.join("; ") : undefined,
      );
    }
    if (!isServerUrl(url)) {
      c.note(
        "server-url",
        [...at, "url"],
        (count, examples) =>
          `${counted(count, "server")} ${count === 1 ? "was" : "were"} left out, since the app needs an absolute http(s) URL or a path starting with /: ${examples}`,
        shown(url || "(no URL)", 80),
      );
      return;
    }
    const description = c.ctx.text(server, "description", at)?.trim() ?? "";
    const named = c.ctx.text(server, "name", at)?.trim();
    let name: string;
    let rest: string;
    if (named) {
      name = named;
      rest = description;
    } else {
      // How the app writes a server: "Name — description".
      const split = description.indexOf(" — ");
      if (split > 0 && split <= 50) {
        name = description.slice(0, split);
        rest = description.slice(split + 3).trim();
      } else if (description !== "" && description.length <= 50) {
        name = description;
        rest = "";
      } else {
        name = hostOf(url) ?? `Server ${index + 1}`;
        rest = description;
      }
    }
    if (name.length > 50) {
      c.note(
        "shortened",
        [...at, named ? "name" : "description"],
        (count, examples) =>
          `${counted(count, "text")} ${count === 1 ? "was" : "were"} longer than the app keeps, so ${count === 1 ? "it was" : "they were"} shortened: ${examples}`,
        "a server name (50 characters)",
      );
      name = shortened(name, 50);
    }
    if (rest.length > 500) {
      c.note(
        "shortened",
        [...at, "description"],
        (count, examples) =>
          `${counted(count, "text")} ${count === 1 ? "was" : "were"} longer than the app keeps, so ${count === 1 ? "it was" : "they were"} shortened: ${examples}`,
        "a server description (500 characters)",
      );
      rest = shortened(rest, 500);
    }
    c.rest(server, at, ["url", "description", "variables", "name"], "a server");
    out.push({
      id: `server-${out.length + 1}`,
      name,
      url: url.slice(0, 2000),
      description: rest,
    });
  });
  return out;
}

export function readSecuritySchemes(c: Converter): SecurityScheme[] {
  const components = own(c.ctx.doc, "components");
  const schemes = isObject(components)
    ? own(components, "securitySchemes")
    : undefined;
  if (schemes === undefined) return [];
  if (!isObject(schemes)) {
    c.ctx.refuse(
      ["components", "securitySchemes"],
      "Expected an object of security schemes",
    );
    return [];
  }
  const out: SecurityScheme[] = [];
  for (const key of Object.keys(schemes)) {
    c.ctx.count();
    const at = ["components", "securitySchemes", key];
    const followed = c.follow(schemes[key], at);
    if (!followed) continue;
    const scheme = followed.value;
    if (!isObject(scheme)) {
      c.ctx.refuse(at, "Expected a security scheme object");
      continue;
    }
    const type = own(scheme, "type");
    let description = c.ctx.text(scheme, "description", at)?.trim() ?? "";
    if (own(scheme, "deprecated") === true) {
      c.note(
        "scheme-deprecated",
        [...at, "deprecated"],
        (_count, examples) =>
          `Security schemes can't be marked deprecated in the app: ${examples}`,
        key,
      );
    }
    let made: SecurityScheme | undefined;
    const validKey = /^[A-Za-z0-9._-]{1,64}$/.test(key);
    if (!validKey) {
      c.note(
        "scheme-key",
        at,
        (_count, examples) =>
          `Security schemes need keys of letters, numbers, dots, hyphens, and underscores (64 at most), so these were left out, and the operations that need only them are public in the project: ${examples}`,
        shown(key, 40),
      );
    } else if (type === "http") {
      const http = (c.ctx.text(scheme, "scheme", at) ?? "").toLowerCase();
      if (http === "bearer") {
        let bearerFormat = (
          c.ctx.text(scheme, "bearerFormat", at) ?? ""
        ).trim();
        if (bearerFormat.length > 50) {
          c.note(
            "shortened",
            [...at, "bearerFormat"],
            (count, examples) =>
              `${counted(count, "text")} ${count === 1 ? "was" : "were"} longer than the app keeps, so ${count === 1 ? "it was" : "they were"} shortened: ${examples}`,
            "a bearer format (50 characters)",
          );
          bearerFormat = shortened(bearerFormat, 50);
        }
        made = {
          id: key,
          key,
          type: "bearer",
          bearerFormat,
          description: "",
        };
      } else if (http === "basic") {
        made = { id: key, key, type: "basic", description: "" };
      } else {
        unsupportedScheme(
          c,
          key,
          at,
          `HTTP ${shown(http, 20) || "(no scheme)"}`,
        );
      }
    } else if (type === "apiKey") {
      const location = own(scheme, "in");
      const name = (c.ctx.text(scheme, "name", at) ?? "").trim();
      if (
        (location === "header" ||
          location === "query" ||
          location === "cookie") &&
        name !== "" &&
        name.length <= 100
      ) {
        made = {
          id: key,
          key,
          type: "apiKey",
          in: location,
          name,
          description: "",
        };
      } else {
        c.ctx.refuse(
          at,
          "An apiKey scheme needs in (header, query, or cookie) and a name",
        );
      }
    } else if (type === "oauth2" || type === "openIdConnect") {
      // Clients send what they get as a Bearer token (RFC 6750).
      const details =
        type === "oauth2"
          ? oauthSummary(own(scheme, "flows"))
          : `OpenID Connect: ${c.ctx.text(scheme, "openIdConnectUrl", at) ?? ""}`;
      description = [description, details].filter(Boolean).join("\n\n");
      made = {
        id: key,
        key,
        type: "bearer",
        bearerFormat: "",
        description: "",
      };
      c.note(
        "scheme-oauth",
        at,
        (_count, examples) =>
          `OAuth 2.0 and OpenID Connect schemes are bearer token schemes in the app; their flows, URLs, and scopes are in each one's description: ${examples}`,
        key,
      );
    } else {
      unsupportedScheme(c, key, at, shownValue(type, 30));
    }
    if (made) {
      if (description.length > 500) {
        c.note(
          "shortened",
          [...at, "description"],
          (count, examples) =>
            `${counted(count, "text")} ${count === 1 ? "was" : "were"} longer than the app keeps, so ${count === 1 ? "it was" : "they were"} shortened: ${examples}`,
          "a security scheme description (500 characters)",
        );
        description = shortened(description, 500);
      }
      made.description = description;
      if (out.length === 20) {
        c.note(
          "schemes-20",
          at,
          (count) =>
            `The app keeps 20 security schemes, so ${counted(count, "more was", "more were")} left out, and the operations that need only them are public in the project`,
        );
        continue;
      }
      out.push(made);
      c.schemeIds.set(key, key);
    }
  }
  return out;
}

export function unsupportedScheme(
  c: Converter,
  key: string,
  at: Segments,
  what: string,
) {
  c.note(
    "scheme-unsupported",
    at,
    (_count, examples) =>
      `These security schemes have no counterpart in the app, so they were left out, and the operations that need only them are public in the project: ${examples}`,
    `${shown(key, 40)} (${shown(what, 30)})`,
  );
}

/**
 * A security requirement list as the app's: none, the default, or any
 * one of some schemes. What it can't say (scopes, schemes required
 * together, optional authentication) is reported, and so is a scheme the
 * project doesn't have: one the document doesn't define (OpenAPI requires
 * it to), or one left out; a requirement with none it has is dropped, so
 * the operation may become public.
 */
export function readSecurity(
  c: Converter,
  value: unknown,
  at: Segments,
): EndpointSecurity | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    c.ctx.refuse(at, "Expected a list of security requirements");
    return undefined;
  }
  const components = own(c.ctx.doc, "components");
  const defined = isObject(components)
    ? own(components, "securitySchemes")
    : undefined;
  const ids: string[] = [];
  let optional = false;
  value.forEach((requirement, index) => {
    c.ctx.count();
    const here = [...at, String(index)];
    if (!isObject(requirement)) {
      c.ctx.refuse(here, "Expected a security requirement object");
      return;
    }
    const names = Object.keys(requirement);
    c.ctx.count(names.length);
    if (names.length === 0) {
      optional = true;
      return;
    }
    const known = names.filter((name) => c.schemeIds.has(name));
    for (const name of names) {
      const scopes = requirement[name];
      if (!c.schemeIds.has(name)) {
        if (!isObject(defined) || !Object.hasOwn(defined, name)) {
          c.note(
            "security-undefined",
            [...here, name],
            (count, examples) =>
              `Security requirements name schemes that components.securitySchemes doesn't define, so they're left out (${counted(count, "requirement")}: ${examples})${known.length === 0 ? "; an operation with no other alternative is public in the project" : ""}`,
            `${shown(name, 40)} (${shownPointer(at, 120)})`,
          );
        }
        continue;
      }
      if (Array.isArray(scopes) && scopes.length > 0) {
        c.note(
          "scopes",
          [...here, name],
          (count, examples) =>
            `Scopes aren't kept (${counted(count, "requirement")}, like ${examples})`,
          `${shown(name, 40)}: ${scopes
            .slice(0, 5)
            .map((scope) => shownValue(scope, 40))
            .join(" ")}${scopes.length > 5 ? " …" : ""}`,
        );
      }
    }
    if (names.length > 1 && known.length > 0) {
      c.note(
        "schemes-together",
        here,
        (count, examples) =>
          `The app records one scheme per alternative, so ${counted(count, "requirement")} for several schemes together ${count === 1 ? "records" : "record"} only the first it has: ${examples}`,
        `${names.map((name) => shown(name, 30)).join(" and ")} → ${shown(known[0] as string, 30)}`,
      );
    }
    const first = known[0];
    if (first !== undefined && !ids.includes(first)) {
      ids.push(first);
    }
  });
  if (ids.length === 0) {
    return { type: "none" };
  }
  if (optional) {
    c.note(
      "optional-auth",
      at,
      (count, examples) =>
        `Authentication is optional in ${counted(count, "place")} (${examples}); the project records it as required`,
      shownPointer(at, 200),
    );
  }
  return { type: "schemes", schemeIds: ids };
}

function isServerUrl(value: string) {
  if (value.startsWith("/")) return value.length <= 2000;
  try {
    const { protocol } = new URL(value);
    return (
      (protocol === "http:" || protocol === "https:") && value.length <= 2000
    );
  } catch {
    return false;
  }
}

function hostOf(url: string) {
  try {
    return new URL(url).host.slice(0, 50) || undefined;
  } catch {
    return undefined;
  }
}

function oauthSummary(flows: unknown) {
  if (!isObject(flows)) return "OAuth 2.0";
  const lines = ["OAuth 2.0"];
  for (const flow of Object.keys(flows)) {
    const value = flows[flow];
    if (!isObject(value)) continue;
    const urls = [
      "authorizationUrl",
      "tokenUrl",
      "deviceAuthorizationUrl",
      "refreshUrl",
    ]
      .map((key) =>
        typeof value[key] === "string" ? `${key} ${value[key]}` : "",
      )
      .filter(Boolean);
    const scopes = isObject(value.scopes) ? Object.keys(value.scopes) : [];
    lines.push(
      `${flow}: ${[...urls, ...(scopes.length > 0 ? [`scopes ${scopes.join(", ")}`] : [])].join("; ")}`,
    );
  }
  return lines.join("\n");
}
