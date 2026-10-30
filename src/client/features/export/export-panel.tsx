import type { LintIssue } from "@shared/export";
import type { PageSummary } from "@shared/pages";
import type { Project } from "@shared/projects";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { CircleAlertIcon, CircleCheckIcon, DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  exportDownloadUrl,
  exportReportQueryOptions,
  markdownDownloadUrl,
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

      <div className="grid gap-4 lg:grid-cols-2">
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
            {(["yaml", "json"] as const).map((format) =>
              valid ? (
                <Button
                  key={format}
                  asChild
                  variant={format === "yaml" ? "default" : "outline"}
                >
                  <a
                    href={exportDownloadUrl(project.id, format, pageId)}
                    download
                  >
                    <DownloadIcon />
                    Download {format.toUpperCase()}
                  </a>
                </Button>
              ) : (
                <Button
                  key={format}
                  disabled
                  variant={format === "yaml" ? "default" : "outline"}
                >
                  <DownloadIcon />
                  Download {format.toUpperCase()}
                </Button>
              ),
            )}
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
              endpoints, and the models. Reads well on GitHub or in any Markdown
              viewer.
            </p>
          </div>
          <div>
            <Button asChild variant="outline">
              <a href={markdownDownloadUrl(project.id, pageId)} download>
                <DownloadIcon />
                Download Markdown (.zip)
              </a>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {report.data && !valid
              ? "The OpenAPI file is left out until the problems below are fixed."
              : "Includes the OpenAPI file, so the bundle has everything."}
          </p>
        </section>
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
  const link =
    warning.target.type === "endpoint" ? (
      <Link
        to="/projects/$projectId/endpoints/$endpointId"
        params={{ projectId, endpointId: warning.target.id }}
        className="text-sm underline underline-offset-4"
      >
        Open
      </Link>
    ) : (
      <Link
        to="/projects/$projectId/models/$modelId"
        params={{ projectId, modelId: warning.target.id }}
        className="text-sm underline underline-offset-4"
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
