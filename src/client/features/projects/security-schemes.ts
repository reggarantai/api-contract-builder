import type { SecurityScheme, SecuritySchemeType } from "@shared/projects";
import { ulid } from "ulid";

export const SECURITY_SCHEME_LABELS: Record<SecuritySchemeType, string> = {
  bearer: "Bearer token",
  apiKey: "API key",
  basic: "Basic auth",
};

const SUGGESTED_KEYS: Record<SecuritySchemeType, string> = {
  bearer: "bearerAuth",
  apiKey: "apiKeyAuth",
  basic: "basicAuth",
};

/** How a client sends the credentials, e.g. "X-API-Key header". */
export function describeSecurityScheme(scheme: SecurityScheme) {
  switch (scheme.type) {
    case "bearer":
      return `Authorization: Bearer ${scheme.bearerFormat || "token"}`;
    case "basic":
      return "Authorization: Basic username:password";
    case "apiKey":
      return `${scheme.name} ${scheme.in === "query" ? "query parameter" : scheme.in}`;
  }
}

/** "bearerAuth", or "bearerAuth2", "bearerAuth3", … if taken. */
function suggestKey(type: SecuritySchemeType, takenKeys: string[]) {
  const base = SUGGESTED_KEYS[type];
  if (!takenKeys.includes(base)) {
    return base;
  }
  for (let n = 2; ; n++) {
    if (!takenKeys.includes(`${base}${n}`)) {
      return `${base}${n}`;
    }
  }
}

function hasSuggestedKey(scheme: SecurityScheme) {
  return new RegExp(`^${SUGGESTED_KEYS[scheme.type]}\\d*$`).test(scheme.key);
}

function withType(
  base: Pick<SecurityScheme, "id" | "key" | "description">,
  type: SecuritySchemeType,
): SecurityScheme {
  switch (type) {
    case "bearer":
      return { ...base, type, bearerFormat: "" };
    case "basic":
      return { ...base, type };
    case "apiKey":
      return { ...base, type, in: "header", name: "X-API-Key" };
  }
}

export function newSecurityScheme(
  type: SecuritySchemeType,
  takenKeys: string[],
): SecurityScheme {
  return withType(
    { id: ulid(), key: suggestKey(type, takenKeys), description: "" },
    type,
  );
}

/**
 * Switches a scheme to another type. A key that was only a suggestion for the
 * old type is replaced by the suggestion for the new one.
 */
export function changeSecuritySchemeType(
  scheme: SecurityScheme,
  type: SecuritySchemeType,
  takenKeys: string[],
): SecurityScheme {
  const key =
    scheme.key === "" || hasSuggestedKey(scheme)
      ? suggestKey(
          type,
          takenKeys.filter((key) => key !== scheme.key),
        )
      : scheme.key;
  return withType(
    { id: scheme.id, key, description: scheme.description },
    type,
  );
}
