import type { EndpointStatus, HttpMethod } from "@shared/endpoints";

export const METHOD_CLASS_NAMES: Record<HttpMethod, string> = {
  GET: "bg-emerald-100 text-emerald-800",
  POST: "bg-sky-100 text-sky-800",
  PUT: "bg-amber-100 text-amber-800",
  PATCH: "bg-violet-100 text-violet-800",
  DELETE: "bg-rose-100 text-rose-800",
  HEAD: "bg-zinc-100 text-zinc-700",
  OPTIONS: "bg-zinc-100 text-zinc-700",
};

export const STATUS_LABELS: Record<EndpointStatus, string> = {
  draft: "Draft",
  review: "In review",
  agreed: "Agreed",
};

export const STATUS_DOT_CLASS_NAMES: Record<EndpointStatus, string> = {
  draft: "bg-zinc-400",
  review: "bg-amber-500",
  agreed: "bg-emerald-500",
};
