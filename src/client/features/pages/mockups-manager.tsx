import type { Mockup, Page } from "@shared/pages";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  useDeleteMockup,
  useReorderMockups,
  useUpdateMockupCaption,
  useUploadMockups,
} from "./queries";

const ACCEPTED_TYPES = "image/png,image/jpeg,image/gif,image/webp";

function showUploadError(error: Error) {
  if (error instanceof ApiError && error.issues.length > 0) {
    for (const issue of error.issues) {
      toast.error(issue.message);
    }
  } else {
    toast.error(error.message);
  }
}

/**
 * Uploads and arranges a page's mockups. Unlike the rest of the page editor,
 * changes here are saved right away.
 */
export function MockupsManager({ page }: { page: Page }) {
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const upload = useUploadMockups(page.projectId, page.id);
  const reorder = useReorderMockups(page.projectId, page.id);

  function uploadFiles(files: File[]) {
    if (files.length === 0) {
      return;
    }
    upload.mutate(files, {
      onSuccess: (uploaded) =>
        toast.success(
          `Uploaded ${uploaded.length} mockup${uploaded.length === 1 ? "" : "s"}`,
        ),
      onError: showUploadError,
    });
  }

  function move(index: number, offset: -1 | 1) {
    const ids = page.mockups.map((mockup) => mockup.id);
    const [moved] = ids.splice(index, 1);
    if (moved) {
      ids.splice(index + offset, 0, moved);
      reorder.mutate(ids, { onError: (error) => toast.error(error.message) });
    }
  }

  return (
    <section aria-label="Mockups" className="grid gap-3 rounded-xl border p-4">
      <div className="grid gap-0.5">
        <h3 className="font-heading font-medium">Mockups</h3>
        <p className="text-sm text-muted-foreground">
          PNG, JPEG, GIF, or WebP. Changes here are saved right away.
        </p>
      </div>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: dropping is a shortcut; the upload button does the same. */}
      <div
        className={cn(
          "flex flex-wrap items-center justify-center gap-3 rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground transition-colors",
          dragging && "border-ring bg-muted/50",
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          uploadFiles([...event.dataTransfer.files]);
        }}
      >
        <span>Drop images here or</span>
        <label
          htmlFor={`${id}-files`}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 font-medium text-foreground hover:bg-muted"
        >
          <UploadIcon className="size-4" />
          Upload mockups
        </label>
        <input
          id={`${id}-files`}
          type="file"
          accept={ACCEPTED_TYPES}
          multiple
          className="sr-only"
          onChange={(event) => {
            uploadFiles([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
        {upload.isPending && <span>Uploading…</span>}
      </div>

      {page.mockups.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {page.mockups.map((mockup, index) => (
            <MockupCard
              key={mockup.id}
              page={page}
              mockup={mockup}
              isFirst={index === 0}
              isLast={index === page.mockups.length - 1}
              onMove={(offset) => move(index, offset)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function MockupCard({
  page,
  mockup,
  isFirst,
  isLast,
  onMove,
}: {
  page: Page;
  mockup: Mockup;
  isFirst: boolean;
  isLast: boolean;
  onMove: (offset: -1 | 1) => void;
}) {
  const [caption, setCaption] = useState(mockup.caption);
  const updateCaption = useUpdateMockupCaption(page.projectId, page.id);
  const deleteMockup = useDeleteMockup(page.projectId, page.id);
  const name = mockup.originalName;

  function saveCaption() {
    if (caption.trim() === mockup.caption) {
      return;
    }
    updateCaption.mutate(
      { mockupId: mockup.id, caption: caption.trim() },
      { onError: (error) => toast.error(error.message) },
    );
  }

  return (
    <li className="grid gap-2 rounded-lg border p-2">
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md bg-muted">
        <img
          src={mockup.url}
          alt={mockup.caption || name}
          className="max-h-full max-w-full object-contain"
        />
      </div>
      <Input
        aria-label={`Caption for ${name}`}
        placeholder="Caption, e.g. Error state"
        value={caption}
        onChange={(event) => setCaption(event.target.value)}
        onBlur={saveCaption}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      <div className="flex items-center gap-1">
        <span
          className="mr-auto truncate text-xs text-muted-foreground"
          title={name}
        >
          {name} · {mockup.width}×{mockup.height}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${name} left`}
          disabled={isFirst}
          onClick={() => onMove(-1)}
        >
          <ArrowLeftIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${name} right`}
          disabled={isLast}
          onClick={() => onMove(1)}
        >
          <ArrowRightIcon />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete ${name}`}
            >
              <Trash2Icon />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
              <AlertDialogDescription>
                The image is removed right away. This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                disabled={deleteMockup.isPending}
                onClick={() =>
                  deleteMockup.mutate(mockup.id, {
                    onError: (error) => toast.error(error.message),
                  })
                }
              >
                Delete mockup
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}
