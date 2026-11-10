import type { ApiIssue } from "@shared/api-error";
import { formatSize } from "@shared/format-size";
import { MAX_OPENAPI_BYTES } from "@shared/project-file";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { CopyIcon, UploadIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { healthQueryOptions } from "@/lib/health";
import { importFileType } from "./import-file";
import { importProjectKey, useImportProject } from "./queries";

type Failure = { fileName: string; error: string; issues: ApiIssue[] };
/** An OpenAPI import, and what it changed or left out. */
type Report = { projectId: string; name: string; notices: ApiIssue[] };

function messageOf(error: unknown) {
  // A server that stops reading a large upload can close the connection
  // before its answer gets through.
  if (error instanceof TypeError) {
    return "The upload stopped before the app answered. If the file is large, it may be more than this instance imports (MAX_IMPORT_MB).";
  }
  return error instanceof Error ? error.message : String(error);
}

/** Issues with their places, one a line, the way the dialogs show them. */
function IssueList({ issues }: { issues: ApiIssue[] }) {
  return (
    <ul className="grid max-h-72 gap-2 overflow-y-auto text-sm">
      {issues.map((issue, index) => (
        <li
          // Issues have no IDs; their place in the list is theirs.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above.
          key={index}
          className="grid gap-0.5"
        >
          <span>{issue.message}</span>
          {issue.path && (
            <code className="font-mono text-xs break-all text-muted-foreground">
              {issue.path}
            </code>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Imports a project file (.project.zip) or an OpenAPI document (JSON or
 * YAML) as a new project, then opens it. An OpenAPI import that changed or
 * left out something first lists it.
 */
export function ImportProjectButton() {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const queryClient = useQueryClient();
  const importProject = useImportProject();
  // While the limit is checked, then while any import runs: one started
  // before leaving this page and coming back too.
  const [checking, setChecking] = useState(false);
  const busy = useIsMutating({ mutationKey: importProjectKey }) > 0 || checking;
  const [failure, setFailure] = useState<Failure | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const open = (projectId: string) =>
    router.navigate({ to: "/projects/$projectId", params: { projectId } });

  async function onFile(file: File) {
    setChecking(true);
    const startedOn = router.state.location.pathname;
    // Someone who went elsewhere during a long upload stays there.
    const stayed = () =>
      mounted.current && router.state.location.pathname === startedOn;
    try {
      const type = await importFileType(file);
      // A file over the limit is refused before it's sent.
      const health = await queryClient
        .fetchQuery(healthQueryOptions())
        .catch(() => undefined);
      const instanceLimit = health?.maxImportBytes ?? Number.POSITIVE_INFINITY;
      const limit = type.openapi
        ? Math.min(MAX_OPENAPI_BYTES, instanceLimit)
        : instanceLimit;
      if (file.size > limit) {
        setFailure({
          fileName: file.name,
          error:
            type.openapi && limit === MAX_OPENAPI_BYTES
              ? `This file is ${formatSize(file.size)}; an OpenAPI document may be at most ${formatSize(MAX_OPENAPI_BYTES)}.`
              : `This file is ${formatSize(file.size)}; this instance imports up to ${formatSize(limit)} (MAX_IMPORT_MB).`,
          issues: [],
        });
        return;
      }
      const importing = importProject.mutateAsync({
        file,
        contentType: type.contentType,
      });
      setChecking(false);
      const { project, notices } = await importing;
      const here = stayed();
      if (here && type.openapi && notices.length > 0) {
        setReport({ projectId: project.id, name: project.name, notices });
        return;
      }
      toast.success(`Imported ${project.name}`, {
        description:
          notices.length > 0
            ? [
                ...notices.slice(0, 3).map((notice) => `${notice.message}.`),
                ...(notices.length > 3
                  ? [`And ${notices.length - 3} more.`]
                  : []),
              ].join(" ")
            : undefined,
        action: here
          ? undefined
          : { label: "Open", onClick: () => void open(project.id) },
      });
      if (here) {
        await open(project.id);
      }
    } catch (error) {
      const failed = {
        fileName: file.name,
        error: messageOf(error),
        issues: error instanceof ApiError ? error.issues : [],
      };
      if (stayed()) {
        setFailure(failed);
      } else {
        // The dialog left with the page, so a toast says it.
        toast.error(`Couldn't import ${failed.fileName}`, {
          description: [
            failed.error,
            ...failed.issues.slice(0, 3).map((issue) => issue.message),
          ].join(" "),
        });
      }
    } finally {
      setChecking(false);
    }
  }

  function copyNotices(notices: ApiIssue[]) {
    const failed = () => toast.error("Couldn't copy; select the text instead");
    // Browsers only offer the clipboard on https and localhost.
    if (!navigator.clipboard) {
      failed();
      return;
    }
    navigator.clipboard
      .writeText(
        notices
          .map((notice) =>
            notice.path ? `${notice.message} (${notice.path})` : notice.message,
          )
          .join("\n"),
      )
      .then(() => toast.success("Copied the notices"), failed);
  }

  return (
    <>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        <UploadIcon />
        {busy ? "Importing…" : "Import project"}
      </Button>
      <input
        ref={input}
        type="file"
        accept=".zip,.json,.yaml,.yml,application/zip,application/json,application/yaml"
        aria-label="Import project"
        className="hidden"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) {
            void onFile(file);
          }
        }}
      />
      <AlertDialog
        open={failure !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setFailure(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Couldn't import {failure?.fileName}
            </AlertDialogTitle>
            <AlertDialogDescription>{failure?.error}</AlertDialogDescription>
          </AlertDialogHeader>
          {failure && failure.issues.length > 0 && (
            <IssueList issues={failure.issues} />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={report !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setReport(null);
          }
        }}
      >
        <AlertDialogContent className="sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Imported {report?.name}</AlertDialogTitle>
            <AlertDialogDescription>
              The OpenAPI document is a project now. These parts of it were
              changed to fit, or aren't kept, each with where it is in the
              document:
            </AlertDialogDescription>
          </AlertDialogHeader>
          {report && <IssueList issues={report.notices} />}
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              onClick={() => report && copyNotices(report.notices)}
            >
              <CopyIcon />
              Copy notices
            </Button>
            <AlertDialogAction
              onClick={() => {
                if (report) {
                  void open(report.projectId);
                }
              }}
            >
              Open project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
