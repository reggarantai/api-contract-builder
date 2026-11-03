import {
  type ApiErrorBody,
  type ApiIssue,
  apiErrorSchema,
} from "@shared/api-error";
import type { z } from "zod";

export class ApiError extends Error {
  readonly status: number;
  readonly issues: ApiIssue[];
  /** Page states that come from what a refused change would remove. */
  readonly pageStates: NonNullable<ApiErrorBody["pageStates"]>;
  /** The current revision, when a save was based on an older one. */
  readonly revision: number | undefined;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error);
    this.name = "ApiError";
    this.status = status;
    this.issues = body.issues ?? [];
    this.pageStates = body.pageStates ?? [];
    this.revision = body.revision;
  }
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  contentType?: string,
) {
  // FormData sets its own multipart Content-Type; a file is sent as it is.
  const isJson =
    body !== undefined &&
    !(body instanceof FormData) &&
    !(body instanceof Blob);
  const type = isJson ? "application/json" : contentType;
  const response = await fetch(`/api${path}`, {
    method,
    headers: type ? { "Content-Type": type } : undefined,
    body: isJson ? JSON.stringify(body) : (body as BodyInit | undefined),
  });

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(
      await response.json().catch(() => null),
    );
    throw new ApiError(
      response.status,
      parsed.success
        ? parsed.data
        : {
            error: `${method} /api${path} failed with status ${response.status}`,
          },
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

/**
 * Posts a file as the request body with the given type: browsers report
 * some types differently (Windows calls a zip application/x-zip-compressed).
 */
export async function apiPostFile<T extends z.ZodType>(
  path: string,
  file: Blob,
  contentType: string,
  schema: T,
): Promise<z.infer<T>> {
  const response = await request("POST", path, file, contentType);
  return schema.parse(await response.json());
}

/** A file the API makes, with the name it suggests for it. */
export async function apiGetFile(
  path: string,
): Promise<{ blob: Blob; fileName: string | undefined }> {
  const response = await request("GET", path);
  const disposition = response.headers.get("Content-Disposition") ?? "";
  return {
    blob: await response.blob(),
    fileName: /filename="([^"]+)"/.exec(disposition)?.[1],
  };
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
