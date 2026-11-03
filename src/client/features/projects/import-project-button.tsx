import type { ApiIssue } from "@shared/api-error";
import { formatSize } from "@shared/format-size";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { UploadIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
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
import { importProjectKey, useImportProject } from "./queries";

type Failure = { fileName: string; error: string; issues: ApiIssue[] };

function messageOf(error: unknown) {
  // A server that stops reading a large upload can close the connection
  // before its answer gets through.
  if (error instanceof TypeError) {
    return "The upload stopped before the app answered. If the file is large, it may be more than this instance imports (MAX_IMPORT_MB).";
  }
  return error instanceof Error ? error.message : String(error);
}

/** Imports a project file (.project.zip) as a new project, then opens it. */
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
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function onFile(file: File) {
    setChecking(true);
    const startedOn = router.state.location.pathname;
    // Someone who went elsewhere during a long upload stays there.
    const stayed = () =>
      mounted.current && router.state.location.pathname === startedOn;
    try {
      // A file over the limit is refused before it's sent.
      const health = await queryClient
        .fetchQuery(healthQueryOptions())
        .catch(() => undefined);
      if (health && file.size > health.maxImportBytes) {
        setFailure({
          fileName: file.name,
          error: `This file is ${formatSize(file.size)}; this instance imports up to ${formatSize(health.maxImportBytes)} (MAX_IMPORT_MB).`,
          issues: [],
        });
        return;
      }
      const importing = importProject.mutateAsync(file);
      setChecking(false);
      const { project, notices } = await importing;
      const open = () =>
        router.navigate({
          to: "/projects/$projectId",
          params: { projectId: project.id },
        });
      const here = stayed();
      toast.success(`Imported ${project.name}`, {
        description:
          notices.length > 0
            ? notices.map((notice) => `${notice.message}.`).join(" ")
            : undefined,
        action: here ? undefined : { label: "Open", onClick: open },
      });
      if (here) {
        await open();
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
        accept=".zip,application/zip"
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
        onOpenChange={(open) => {
          if (!open) {
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
            <ul className="grid max-h-72 gap-2 overflow-y-auto text-sm">
              {failure.issues.map((issue, index) => (
                <li
                  // Issues have no IDs; their place in the list is theirs.
                  // biome-ignore lint/suspicious/noArrayIndexKey: see above.
                  key={index}
                  className="grid gap-0.5"
                >
                  <span>{issue.message}</span>
                  {issue.path && (
                    <code className="font-mono text-xs text-muted-foreground">
                      {issue.path}
                    </code>
                  )}
                </li>
              ))}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
