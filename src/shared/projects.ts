import { z } from "zod";
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from "./slug";

export const projectNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(100);

export const slugSchema = z
  .string()
  .trim()
  .min(1, "Slug is required")
  .max(SLUG_MAX_LENGTH)
  .regex(SLUG_PATTERN, "Use lowercase letters, numbers, and single hyphens");

export const projectDescriptionSchema = z.string().trim().max(2000);

export const apiVersionSchema = z
  .string()
  .trim()
  .min(1, "API version is required")
  .max(50);

export const DEFAULT_API_VERSION = "1.0.0";

/** Client-generated ID for items stored inside a project (servers, schemes). */
const itemIdSchema = z.string().min(1).max(64);

function isServerUrl(value: string) {
  if (value.startsWith("/")) {
    return true;
  }
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export const serverSchema = z.object({
  id: itemIdSchema,
  name: z.string().trim().min(1, "Name is required").max(50),
  url: z
    .string()
    .trim()
    .min(1, "URL is required")
    .max(2000)
    .refine(
      isServerUrl,
      "Use an absolute http(s) URL or a path starting with /",
    ),
  description: z.string().trim().max(500),
});

const securitySchemeBase = {
  id: itemIdSchema,
  /** Name under `components.securitySchemes` in the OpenAPI export. */
  key: z
    .string()
    .trim()
    .min(1, "Key is required")
    .max(64)
    .regex(
      /^[A-Za-z0-9._-]+$/,
      "Use letters, numbers, dots, hyphens, and underscores",
    ),
  description: z.string().trim().max(500),
};

export const API_KEY_LOCATIONS = ["header", "query", "cookie"] as const;

export const securitySchemeSchema = z.discriminatedUnion("type", [
  z.object({
    ...securitySchemeBase,
    type: z.literal("bearer"),
    bearerFormat: z.string().trim().max(50),
  }),
  z.object({
    ...securitySchemeBase,
    type: z.literal("basic"),
  }),
  z.object({
    ...securitySchemeBase,
    type: z.literal("apiKey"),
    in: z.enum(API_KEY_LOCATIONS),
    name: z.string().trim().min(1, "Parameter name is required").max(100),
  }),
]);

export const SECURITY_SCHEME_TYPES = ["bearer", "apiKey", "basic"] as const;

/** Editable project fields, without cross-field rules (see `projectSettingsSchema`). */
export const projectSettingsFieldsSchema = z.object({
  name: projectNameSchema,
  slug: slugSchema,
  description: projectDescriptionSchema,
  apiVersion: apiVersionSchema,
  servers: z.array(serverSchema).max(20),
  securitySchemes: z.array(securitySchemeSchema).max(20),
  /** Scheme applied to endpoints by default; null means no authentication. */
  defaultSecuritySchemeId: z.string().nullable(),
});

function addDuplicateIssues<T>(
  ctx: z.RefinementCtx,
  items: T[],
  getValue: (item: T) => string,
  path: (index: number) => (string | number)[],
  message: string,
) {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const value = getValue(item);
    if (seen.has(value)) {
      ctx.addIssue({ code: "custom", path: path(index), message });
    }
    seen.add(value);
  });
}

type SecuritySettings = Pick<
  ProjectSettings,
  "securitySchemes" | "defaultSecuritySchemeId"
>;

function refineSecuritySettings(
  settings: SecuritySettings,
  ctx: z.RefinementCtx,
) {
  addDuplicateIssues(
    ctx,
    settings.securitySchemes,
    (scheme) => scheme.id,
    (index) => ["securitySchemes", index, "id"],
    "Scheme IDs must be unique",
  );
  addDuplicateIssues(
    ctx,
    settings.securitySchemes,
    (scheme) => scheme.key,
    (index) => ["securitySchemes", index, "key"],
    "Key must be unique",
  );

  const { defaultSecuritySchemeId } = settings;
  if (
    defaultSecuritySchemeId !== null &&
    !settings.securitySchemes.some(
      (scheme) => scheme.id === defaultSecuritySchemeId,
    )
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["defaultSecuritySchemeId"],
      message: "Default scheme must be one of this project's schemes",
    });
  }
}

/** Security schemes plus the default, with cross-field rules. */
export const securitySettingsSchema = projectSettingsFieldsSchema
  .pick({ securitySchemes: true, defaultSecuritySchemeId: true })
  .superRefine(refineSecuritySettings);

export const projectSettingsSchema = projectSettingsFieldsSchema.superRefine(
  (settings, ctx) => {
    addDuplicateIssues(
      ctx,
      settings.servers,
      (server) => server.id,
      (index) => ["servers", index, "id"],
      "Server IDs must be unique",
    );
    refineSecuritySettings(settings, ctx);
  },
);

export const createProjectInputSchema = z.object({
  name: projectNameSchema,
  /** Derived from the name when omitted. */
  slug: slugSchema.optional(),
  description: projectDescriptionSchema.default(""),
  apiVersion: apiVersionSchema.default(DEFAULT_API_VERSION),
});

export const updateProjectInputSchema = projectSettingsFieldsSchema.partial();

export const projectSchema = projectSettingsFieldsSchema.extend({
  id: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const projectSummarySchema = projectSchema.pick({
  id: true,
  name: true,
  slug: true,
  description: true,
  apiVersion: true,
  createdAt: true,
  updatedAt: true,
});

export type Server = z.infer<typeof serverSchema>;
export type SecurityScheme = z.infer<typeof securitySchemeSchema>;
export type SecuritySchemeType = SecurityScheme["type"];
export type ProjectSettings = z.infer<typeof projectSettingsFieldsSchema>;
export type CreateProjectInput = z.input<typeof createProjectInputSchema>;
export type UpdateProjectInput = z.input<typeof updateProjectInputSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
