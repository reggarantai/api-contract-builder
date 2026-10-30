import { type ApiIssue, apiErrorSchema } from "@shared/api-error";
import type { z } from "zod";

export class ApiError extends Error {
  readonly status: number;
  readonly issues: ApiIssue[];

  constructor(status: number, message: string, issues: ApiIssue[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
  }
}

async function request(method: string, path: string, body?: unknown) {
  // FormData sets its own multipart Content-Type.
  const isJson = body !== undefined && !(body instanceof FormData);
  const response = await fetch(`/api${path}`, {
    method,
    headers: isJson ? { "Content-Type": "application/json" } : undefined,
    body: isJson ? JSON.stringify(body) : (body as FormData | undefined),
  });

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(
      await response.json().catch(() => null),
    );
    throw parsed.success
      ? new ApiError(response.status, parsed.data.error, parsed.data.issues)
      : new ApiError(
          response.status,
          `${method} /api${path} failed with status ${response.status}`,
        );
  }
  return response;
}

export async function apiGet<T extends z.ZodType>(
  path: string,
  schema: T,
): Promise<z.infer<T>> {
  const response = await request("GET", path);
  return schema.parse(await response.json());
}

export async function apiPost<T extends z.ZodType>(
  path: string,
  body: unknown,
  schema: T,
): Promise<z.infer<T>> {
  const response = await request("POST", path, body);
  return schema.parse(await response.json());
}

export async function apiPut<T extends z.ZodType>(
  path: string,
  body: unknown,
  schema: T,
): Promise<z.infer<T>> {
  const response = await request("PUT", path, body);
  return schema.parse(await response.json());
}

/** Posts files as multipart form data. */
export async function apiUpload<T extends z.ZodType>(
  path: string,
  form: FormData,
  schema: T,
): Promise<z.infer<T>> {
  const response = await request("POST", path, form);
  return schema.parse(await response.json());
}

export async function apiPatch<T extends z.ZodType>(
  path: string,
  body: unknown,
  schema: T,
): Promise<z.infer<T>> {
  const response = await request("PATCH", path, body);
  return schema.parse(await response.json());
}

export async function apiDelete(path: string): Promise<void> {
  await request("DELETE", path);
}
