import type { EndpointStatus, HttpMethod } from "@shared/endpoints";
import { cn } from "@/lib/utils";
import {
  METHOD_CLASS_NAMES,
  STATUS_DOT_CLASS_NAMES,
  STATUS_LABELS,
} from "./labels";

export function MethodBadge({
  method,
  className,
}: {
  method: HttpMethod;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-16 shrink-0 justify-center rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold",
        METHOD_CLASS_NAMES[method],
        className,
      )}
    >
      {method}
    </span>
  );
}

export function StatusLabel({ status }: { status: EndpointStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={cn("size-2 rounded-full", STATUS_DOT_CLASS_NAMES[status])}
      />
      {STATUS_LABELS[status]}
    </span>
  );
}
