import { z } from "zod";
import { slugSchema } from "./projects";

/** When a page calls an endpoint. */
export const PAGE_TRIGGERS = [
  "on_load",
  "on_submit",
  "on_action",
  "other",
] as const;
export type PageTrigger = (typeof PAGE_TRIGGERS)[number];

export const PAGE_TRIGGER_LABELS: Record<PageTrigger, string> = {
  on_load: "When the page loads",
  on_submit: "On form submit",
  on_action: "On a user action",
  other: "Other",
};

/** Image types a mockup can be, by the type `image-size` detects. */
export const MOCKUP_MIME_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
} as const;

export const pageNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(100);

const markdownSchema = z.string().trim().max(20_000);

export const pageEndpointLinkSchema = z.object({
  /** Client-generated ID of the link itself. */
  id: z.string().min(1).max(64),
  endpointId: z.string().min(1, "Pick an endpoint"),
  trigger: z.enum(PAGE_TRIGGERS),
  note: z.string().trim().max(500),
});

/** Editable page fields, without cross-field rules (see `pageFieldsSchema`). */
const pageFieldsBaseSchema = z.object({
  name: pageNameSchema,
  slug: slugSchema,
  description: markdownSchema,
  acceptanceCriteria: markdownSchema,
  /** The endpoints the page calls, in the order it calls them. */
  endpoints: z.array(pageEndpointLinkSchema).max(50),
});

export const pageFieldsSchema = pageFieldsBaseSchema.superRefine(
  (page, ctx) => {
    const seen = new Set<string>();
    page.endpoints.forEach((link, index) => {
      const key = `${link.endpointId} ${link.trigger}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["endpoints", index, "endpointId"],
          message: "Already listed with the same trigger",
        });
      }
      seen.add(key);
    });
  },
);

export const createPageInputSchema = z.object({
  name: pageNameSchema,
  /** Derived from the name when omitted. */
  slug: slugSchema.optional(),
});

export const updatePageInputSchema = pageFieldsBaseSchema.partial();

export const pageOrderInputSchema = z.object({
  pageIds: z.array(z.string()),
});

export const mockupSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  /** Where the image is served, e.g. /uploads/<project>/<id>.png. */
  url: z.string(),
  originalName: z.string(),
  mimeType: z.enum(Object.values(MOCKUP_MIME_TYPES)),
  width: z.number().int(),
  height: z.number().int(),
  caption: z.string(),
  createdAt: z.iso.datetime(),
});

export const updateMockupInputSchema = z.object({
  caption: z.string().trim().max(300),
});

export const mockupOrderInputSchema = z.object({
  mockupIds: z.array(z.string()),
});

export const pageSchema = pageFieldsBaseSchema.extend({
  id: z.string(),
  projectId: z.string(),
  mockups: z.array(mockupSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const pageSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  slug: z.string(),
  endpointCount: z.number().int(),
  mockupCount: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type PageFields = z.infer<typeof pageFieldsBaseSchema>;
export type PageEndpointLink = z.infer<typeof pageEndpointLinkSchema>;
export type Mockup = z.infer<typeof mockupSchema>;
export type Page = z.infer<typeof pageSchema>;
export type PageSummary = z.infer<typeof pageSummarySchema>;
export type CreatePageInput = z.input<typeof createPageInputSchema>;
export type UpdatePageInput = z.input<typeof updatePageInputSchema>;
