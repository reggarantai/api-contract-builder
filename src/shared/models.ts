import { z } from "zod";
import { isJsonObject, type JsonSchema } from "./json-schema";
import { revisionInputSchema, revisionSchema } from "./revision";

export const modelNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(64)
  .regex(
    /^[A-Za-z0-9._-]+$/,
    "Use letters, numbers, dots, hyphens, and underscores",
  );

export const modelDescriptionSchema = z.string().trim().max(2000);

export const jsonSchemaSchema = z.custom<JsonSchema>(
  isJsonObject,
  "Schema must be a JSON object",
);

export const DEFAULT_MODEL_SCHEMA: JsonSchema = {
  type: "object",
  properties: {},
};

export const createModelInputSchema = z.object({
  name: modelNameSchema,
  description: modelDescriptionSchema.default(""),
  schema: jsonSchemaSchema.optional(),
});

/** A model's editable fields. */
export const modelFieldsSchema = z.object({
  name: modelNameSchema,
  description: modelDescriptionSchema,
  schema: jsonSchemaSchema,
});

export const updateModelInputSchema = modelFieldsSchema
  .partial()
  .extend({ revision: revisionInputSchema });

export const modelSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  description: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const modelSchema = modelSummarySchema.extend({
  schema: jsonSchemaSchema,
  revision: revisionSchema,
});

export type CreateModelInput = z.input<typeof createModelInputSchema>;
export type UpdateModelInput = z.input<typeof updateModelInputSchema>;
export type ModelSummary = z.infer<typeof modelSummarySchema>;
export type Model = z.infer<typeof modelSchema>;
