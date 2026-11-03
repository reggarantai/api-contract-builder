import type { LintIssue } from "@shared/export";
import { formatSize } from "@shared/format-size";
import type { PageSummary } from "@shared/pages";
import type { Project } from "@shared/projects";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { CircleAlertIcon, CircleCheckIcon, DownloadIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, apiGetFile } from "@/lib/api";
import {
  exportDownloadPath,
  exportReportQueryOptions,
  markdownDownloadPath,
  projectFileDownloadUrl,
  projectFileReportQueryOptions,
} from "./queries";

const WHOLE_PROJECT = "all";

export function ExportPanel({
  project,
  pages,
  pageId,
}: {
  project: Project;
  pages: PageSummary[];
  /** Export only this page; undefined exports the whole project. */
  pageId?: string;
}) {
  const navigate = useNavigate();
  const report = useQuery(exportReportQueryOptions(project.id, pageId));
  const page = pages.find((item) => item.id === pageId);
  const fileBase = [project.slug, page?.slug, "openapi"]
    .filter(Boolean)
    .join(".");
  const valid = report.data?.valid === true;

  return (
    <div className="grid gap-6">
      <Field className="max-w-xs">
        <FieldLabel htmlFor="export-scope">Scope</FieldLabel>
        <Select
          value={pageId ?? WHOLE_PROJECT}
          onValueChange={(value) =>
            void navigate({
              to: "/projects/$projectId/export",
              params: { projectId: project.id },
              search: value === WHOLE_PROJECT ? {} : { page: value },
            })
          }
        >
          <SelectTrigger id="export-scope" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={WHOLE_PROJECT}>Whole project</SelectItem>
            {pages.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <section
          aria-label="OpenAPI"
          className="grid content-start gap-4 rounded-xl border p-4"
        >
          <div className="grid gap-0.5">
            <h3 className="font-heading font-medium">OpenAPI 3.1</h3>
            <p className="text-sm text-muted-foreground">
              For frontend and backend tools: code generators, API docs, and
              mock servers.
            </p>
          </div>

          <ValidityStatus isPending={report.isPending} valid={valid} />

          <div className="flex flex-wrap gap-2">
            {(["yaml", "json"] as const).map((format) => (
              <DownloadButton
                key={format}
                path={exportDownloadPath(project.id, format, pageId)}
                what={`OpenAPI ${format.toUpperCase()}`}
                variant={format === "yaml" ? "default" : "outline"}
                disabled={!valid}
              >
                Download {format.toUpperCase()}
              </DownloadButton>
            ))}
          </div>

          <p className="text-sm text-muted-foreground">
            The frontend can run a mock server from it:{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              npx @stoplight/prism-cli mock {fileBase}.yaml
            </code>
          </p>
        </section>

        <section
          aria-label="Markdown"
          className="grid content-start gap-4 rounded-xl border p-4"
        >
          <div className="grid gap-0.5">
            <h3 className="font-heading font-medium">Markdown</h3>
            <p className="text-sm text-muted-foreground">
              For people: a README, one file per page with its mockups and
              endpoints, the models, and the error types. Reads well on GitHub
              or in any Markdown viewer.
            </p>
          </div>
          <div>
            <DownloadButton
              path={markdownDownloadPath(project.id, pageId)}
              what="Markdown bundle"
              variant="outline"
            >
              Download Markdown (.zip)
            </DownloadButton>
          </div>
          <p className="text-sm text-muted-foreground">
            {report.data && !valid
              ? "The OpenAPI file is left out until the problems below are fixed."
              : "Includes the OpenAPI file, so the bundle has everything."}
          </p>
        </section>

        <ProjectFileSection projectId={project.id} />
      </div>

      {report.data && report.data.errors.length > 0 && (
        <section
          aria-label="Errors"
          className="grid gap-2 rounded-xl border border-destructive/40 p-4"
        >
          <h3 className="font-heading font-medium text-destructive">
            Fix these before exporting
          </h3>
          <ul className="grid list-disc gap-1 pl-5 text-sm">
            {report.data.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </section>
      )}

      {report.data && (
        <section
          aria-label="Warnings"
          className="grid gap-2 rounded-xl border p-4"
        >
          <h3 className="font-heading font-medium">
            Warnings
            {report.data.warnings.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {report.data.warnings.length}
              </span>
            )}
          </h3>
          {report.data.warnings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No warnings.</p>
          ) : (
            <ul className="divide-y">
              {report.data.warnings.map((warning) => (
                <WarningItem
                  key={`${warning.kind} ${warning.message}`}
                  projectId={project.id}
                  warning={warning}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

/** The whole project as a file, to import elsewhere; the scope doesn't apply. */
function ProjectFileSection({ projectId }: { projectId: string }) {
  const report = useQuery(projectFileReportQueryOptions(projectId));
  return (
    <section
      aria-label="Project file"
      className="grid content-start gap-4 rounded-xl border p-4"
    >
      <div className="grid gap-0.5">
        <h3 className="font-heading font-medium">Project file</h3>
        <p className="text-sm text-muted-foreground">
          Everything in this project, mockups included, to import on another
          machine or instance, or to keep as a backup.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline">
          <a href={projectFileDownloadUrl(projectId)} download>
            <DownloadIcon />
            Download project file
          </a>
        </Button>
        {report.data && (
          <span className="text-sm text-muted-foreground">
            About {formatSize(report.data.size)}
          </span>
        )}
      </div>
      {report.isError && (
        <p className="text-sm text-destructive">{report.error.message}</p>
      )}
      {report.data && report.data.issues.length > 0 && (
        <ul className="grid list-disc gap-1 pl-5 text-sm text-amber-700">
          {report.data.issues.map((issue, index) => (
            // Two can read the same (two pages' images of one name).
            // biome-ignore lint/suspicious/noArrayIndexKey: see above.
            <li key={index}>{issue}</li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">
        Always the whole project. To open it elsewhere, choose{" "}
        <span className="font-medium text-foreground">Import project</span> on
        the Projects page.
      </p>
    </section>
  );
}

/** Saves a file from memory under `name`, as a download. */
function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Long enough for the browser to start saving it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Downloads an export through the API, so a refusal (a bundle too large to
 * export, say) shows its reason instead of a failed download.
 */
function DownloadButton({
  path,
  what,
  variant,
  disabled = false,
  children,
}: {
  path: string;
  /** What's downloaded, for the message when it can't be. */
  what: string;
  variant: "default" | "outline";
  disabled?: boolean;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const { blob, fileName } = await apiGetFile(path);
      saveFile(blob, fileName ?? "export");
    } catch (error) {
      toast.error(`Couldn't download the ${what}`, {
        description:
          error instanceof ApiError
            ? error.message
            : "The connection to the app stopped. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant={variant}
      disabled={disabled || busy}
      onClick={() => void download()}
    >
      <DownloadIcon />
      {busy ? "Downloading…" : children}
    </Button>
  );
}

function ValidityStatus({
  isPending,
  valid,
}: {
  isPending: boolean;
  valid: boolean;
}) {
  if (isPending) {
    return <p className="text-sm text-muted-foreground">Checking…</p>;
  }
  return valid ? (
    <p className="flex items-center gap-2 text-sm text-emerald-700">
      <CircleCheckIcon className="size-4" />
      Valid OpenAPI 3.1
    </p>
  ) : (
    <p className="flex items-center gap-2 text-sm text-destructive">
      <CircleAlertIcon className="size-4" />
      Not valid OpenAPI yet
    </p>
  );
}

function WarningItem({
  projectId,
  warning,
}: {
  projectId: string;
  warning: LintIssue;
}) {
  const className = "text-sm underline underline-offset-4";
  const link =
    warning.target.type === "endpoint" ? (
      <Link
        to="/projects/$projectId/endpoints/$endpointId"
        params={{ projectId, endpointId: warning.target.id }}
        className={className}
      >
        Open
      </Link>
    ) : warning.target.type === "error-type" ? (
      <Link
        to="/projects/$projectId/error-types/$errorTypeId"
        params={{ projectId, errorTypeId: warning.target.id }}
        className={className}
      >
        Open
      </Link>
    ) : (
      <Link
        to="/projects/$projectId/models/$modelId"
        params={{ projectId, modelId: warning.target.id }}
        className={className}
      >
        Open
      </Link>
    );
  return (
    <li className="flex items-center justify-between gap-4 py-2 text-sm">
      <span>{warning.message}</span>
      {link}
    </li>
  );
}
