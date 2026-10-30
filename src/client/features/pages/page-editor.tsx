import { zodResolver } from "@hookform/resolvers/zod";
import { type Page, type PageFields, pageFieldsSchema } from "@shared/pages";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, EyeIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { MarkdownField } from "@/components/markdown-field";
import { SaveButtons } from "@/components/save-buttons";
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { showRequestError } from "@/lib/forms";
import { endpointsQueryOptions } from "../endpoints/queries";
import { EndpointLinksEditor } from "./endpoint-links-editor";
import { MockupsManager } from "./mockups-manager";
import { pageKeys, useDeletePage, useUpdatePage } from "./queries";

export function PageEditor({ page }: { page: Page }) {
  const projectId = page.projectId;
  const endpoints = useQuery(endpointsQueryOptions(projectId)).data ?? [];
  const updatePage = useUpdatePage(projectId, page.id);
  // Mockups change outside this form, so only the form's own fields reset it.
  const {
    name,
    slug,
    description,
    acceptanceCriteria,
    endpoints: links,
  } = page;
  const values = useMemo<PageFields>(
    () => ({ name, slug, description, acceptanceCriteria, endpoints: links }),
    [name, slug, description, acceptanceCriteria, links],
  );
  const form = useForm<PageFields, unknown, PageFields>({
    resolver: zodResolver(pageFieldsSchema),
    values,
  });
  const { isDirty } = form.formState;

  useBlocker({
    shouldBlockFn: () =>
      isDirty && !window.confirm("Leave without saving your changes?"),
    enableBeforeUnload: () => isDirty,
  });

  const onSubmit = form.handleSubmit((input) =>
    updatePage.mutate(input, {
      onSuccess: () => toast.success("Page saved"),
      onError: (error) => showRequestError(error, form.setError),
    }),
  );

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      <div className="flex items-center justify-between gap-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/projects/$projectId/pages" params={{ projectId }}>
            <ArrowLeftIcon />
            All pages
          </Link>
        </Button>
        <div className="flex gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link
              to="/projects/$projectId/pages/$pageId"
              params={{ projectId, pageId: page.id }}
            >
              <EyeIcon />
              View page
            </Link>
          </Button>
          <DeletePageButton page={page} />
        </div>
      </div>

      <div className="grid gap-4 rounded-xl border p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Controller
            control={form.control}
            name="name"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="page-editor-name">Name</FieldLabel>
                <Input
                  {...field}
                  id="page-editor-name"
                  autoComplete="off"
                  aria-invalid={fieldState.invalid}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="slug"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="page-editor-slug">Slug</FieldLabel>
                <Input
                  {...field}
                  id="page-editor-slug"
                  className="font-mono"
                  autoComplete="off"
                  aria-invalid={fieldState.invalid}
                />
                <FieldDescription>Used in export file names.</FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </div>
        <Controller
          control={form.control}
          name="description"
          render={({ field, fieldState }) => (
            <MarkdownField
              label="Description"
              value={field.value}
              onChange={field.onChange}
              placeholder="What the page is for and how it behaves. Markdown is fine."
              error={fieldState.error?.message}
            />
          )}
        />
        <Controller
          control={form.control}
          name="acceptanceCriteria"
          render={({ field, fieldState }) => (
            <MarkdownField
              label="Acceptance criteria"
              value={field.value}
              onChange={field.onChange}
              placeholder={"- [ ] A wrong password shows an error\n- [ ] …"}
              rows={5}
              error={fieldState.error?.message}
            />
          )}
        />
      </div>

      <MockupsManager page={page} />

      <EndpointLinksEditor
        form={form}
        projectId={projectId}
        endpoints={endpoints}
      />

      <div className="sticky bottom-0 -mx-2 flex items-center justify-end gap-2 border-t bg-background/95 px-2 py-3 backdrop-blur">
        <SaveButtons
          isDirty={isDirty}
          isSaving={updatePage.isPending}
          onReset={() => form.reset(values)}
        />
      </div>
    </form>
  );
}

function DeletePageButton({ page }: { page: Page }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deletePage = useDeletePage(page.projectId);

  async function onDelete() {
    try {
      await deletePage.mutateAsync(page.id);
    } catch (error) {
      setOpen(false);
      toast.error((error as Error).message);
      return;
    }
    setOpen(false);
    await navigate({
      to: "/projects/$projectId/pages",
      params: { projectId: page.projectId },
    });
    queryClient.removeQueries({
      queryKey: pageKeys.detail(page.projectId, page.id),
    });
    toast.success(`Deleted ${page.name}`);
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <Trash2Icon />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {page.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its mockups are deleted too. The endpoints it uses stay. This can't
            be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={deletePage.isPending}
            onClick={onDelete}
          >
            Delete page
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
