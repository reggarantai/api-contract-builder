import { healthResponseSchema } from "@shared/health";
import { queryOptions } from "@tanstack/react-query";
import { apiGet } from "./api";

/** The server's version and limits; the header shows whether it answers. */
export function healthQueryOptions() {
  return queryOptions({
    queryKey: ["health"],
    queryFn: () => apiGet("/health", healthResponseSchema),
    refetchInterval: 30_000,
  });
}
