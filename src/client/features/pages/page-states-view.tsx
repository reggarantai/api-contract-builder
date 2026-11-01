import {
  causeText,
  PAGE_STATE_KIND_LABELS,
  type PageState,
  type PageStateKind,
  prismHeaderLines,
  type ResolvedCause,
  resolveCause,
  type StateCause,
} from "@shared/page-states";
import { linkLabel, type Page } from "@shared/pages";
import { Link } from "@tanstack/react-router";
import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MethodBadge } from "../endpoints/badges";
import { MockupGallery } from "./mockup-gallery";
import { type PageCalls, usePageCalls } from "./page-calls";

const KIND_CLASS_NAMES: Record<PageStateKind, string> = {
  idle: "bg-zinc-100 text-zinc-700",
  loading: "bg-sky-100 text-sky-800",
  success: "bg-emerald-100 text-emerald-800",
  empty: "bg-amber-100 text-amber-800",
  error: "bg-rose-100 text-rose-800",
};

export function KindBadge({ kind }: { kind: PageStateKind }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold",
        KIND_CLASS_NAMES[kind],
      )}
    >
      {PAGE_STATE_KIND_LABELS[kind]}
    </span>
  );
}

/** A page's states as people read them: what each shows, and what leads there. */
export function PageStatesView({ page }: { page: Page }) {
  const used = new Set(
    page.states.flatMap((state) => state.causes.map((cause) => cause.linkId)),
  );
  const calls = usePageCalls(
    page.projectId,
    page.endpoints
      .filter((link) => used.has(link.id))
      .map((link) => link.endpointId),
    used.size > 0,
  );

  return (
    <div className="grid gap-4">
      {page.states.map((state) => (
        <StateCard key={state.id} page={page} state={state} calls={calls} />
      ))}
    </div>
  );
}

function StateCard({
  page,
  state,
  calls,
}: {
  page: Page;
  state: PageState;
  calls: PageCalls;
}) {
  const causes = state.causes.flatMap((cause) => {
    const resolved = resolveCause(
      cause,
      page.endpoints,
      calls.endpointsById,
      calls.errorTypesById,
    );
    return "error" in resolved ? [] : [{ cause, resolved }];
  });
  const running = causes.filter(({ cause }) => cause.type === "request");
  const answers = causes.filter(({ cause }) => cause.type !== "request");
  const mockups = page.mockups.filter((mockup) =>
    state.mockupIds.includes(mockup.id),
  );

  return (
    <section
      aria-label={state.name}
      className="grid gap-3 rounded-xl border p-4"
    >
      <div className="flex items-center gap-2">
        <KindBadge kind={state.kind} />
        <h4 className="font-medium">{state.name}</h4>
      </div>
      {state.description && <Markdown>{state.description}</Markdown>}
      {running.length > 0 && (
        <div className="grid gap-1">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">Waits for</span>
            {running.map(({ cause, resolved }) => (
              <CallLink key={cause.linkId} page={page} resolved={resolved} />
            ))}
          </p>
          <p className="text-xs text-muted-foreground">
            Prism answers right away: slow the network down in the browser's
            developer tools to see this state.
          </p>
        </div>
      )}
      {answers.length > 0 && (
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Comes from</span>
          <ul className="divide-y rounded-lg border">
            {answers.map(({ cause, resolved }) => (
              <CauseRow
                key={JSON.stringify(cause)}
                page={page}
                cause={cause}
                resolved={resolved}
              />
            ))}
          </ul>
        </div>
      )}
      {mockups.length > 0 && <MockupGallery mockups={mockups} />}
    </section>
  );
}

function CallLink({ page, resolved }: { page: Page; resolved: ResolvedCause }) {
  const { endpoint, link } = resolved;
  const label = linkLabel(link, endpoint, page.endpoints);
  return (
    <Link
      to="/projects/$projectId/endpoints/$endpointId"
      params={{ projectId: page.projectId, endpointId: endpoint.id }}
      className="inline-flex items-center gap-2 hover:underline"
    >
      <MethodBadge method={endpoint.method} />
      <span className="font-mono text-sm">
        {label.slice(endpoint.method.length + 1)}
      </span>
    </Link>
  );
}

function CauseRow({
  page,
  cause,
  resolved,
}: {
  page: Page;
  cause: StateCause;
  resolved: ResolvedCause;
}) {
  const headers = resolved.mock ? prismHeaderLines(resolved.mock) : [];

  function copy() {
    const failed = () => toast.error("Couldn't copy; select the text instead");
    // Browsers only offer the clipboard on https and localhost.
    if (!navigator.clipboard) {
      failed();
      return;
    }
    navigator.clipboard
      .writeText(headers.join("\n"))
      .then(() => toast.success("Copied the Prism headers"), failed);
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
      <CallLink page={page} resolved={resolved} />
      <span className="text-sm text-muted-foreground">
        {causeText(cause, resolved)}
      </span>
      {headers.length > 0 ? (
        <span className="ml-auto flex items-center gap-1">
          <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs whitespace-pre">
            {headers.join("\n")}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Copy Prism headers"
            onClick={copy}
          >
            <CopyIcon />
          </Button>
        </span>
      ) : (
        <span className="ml-auto text-xs text-muted-foreground">
          No status code reaches this response in Prism
        </span>
      )}
    </li>
  );
}
