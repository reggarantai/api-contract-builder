import {
  createEndpointDefaults,
  type Endpoint,
  type EndpointFields,
  type HttpMethod,
} from "../../shared/endpoints";
import type { JsonSchema } from "../../shared/json-schema";
import type { Model } from "../../shared/models";
import type { Page, PageEndpointLink } from "../../shared/pages";
import type { Project } from "../../shared/projects";
import type { ExportInput } from "./openapi";

// Builders for export unit tests: plain objects, no database.

const TIME = "2026-01-01T00:00:00.000Z";

export function testProject(changes: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Inventory App",
    slug: "inventory-app",
    description: "",
    apiVersion: "1.0.0",
    servers: [],
    securitySchemes: [],
    defaultSecuritySchemeId: null,
    createdAt: TIME,
    updatedAt: TIME,
    ...changes,
  };
}

export function testModel(
  id: string,
  name: string,
  schema: JsonSchema,
  description = "",
): Model {
  return {
    id,
    projectId: "p1",
    name,
    description,
    schema,
    createdAt: TIME,
    updatedAt: TIME,
  };
}

export function testEndpoint(
  id: string,
  method: HttpMethod,
  path: string,
  changes: Partial<EndpointFields> = {},
): Endpoint {
  let n = 0;
  return {
    ...createEndpointDefaults(method, path, "", () => `${id}-r${n++}`),
    ...changes,
    id,
    projectId: "p1",
    createdAt: TIME,
    updatedAt: TIME,
  };
}

export function testPage(
  id: string,
  name: string,
  links: Omit<PageEndpointLink, "id">[] = [],
  changes: Partial<Page> = {},
): Page {
  return {
    id,
    projectId: "p1",
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    description: "",
    acceptanceCriteria: "",
    endpoints: links.map((link, index) => ({ ...link, id: `${id}-l${index}` })),
    mockups: [],
    createdAt: TIME,
    updatedAt: TIME,
    ...changes,
  };
}

export function testInput(changes: Partial<ExportInput> = {}): ExportInput {
  return {
    project: testProject(),
    models: [],
    endpoints: [],
    pages: [],
    ...changes,
  };
}
