import type { Project } from "@shared/projects";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { projectKeys, useDeleteProject } from "../queries";
import { SettingsSection } from "./settings-section";

export function DeleteProject({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deleteProject = useDeleteProject();
  const confirmed = confirmation === project.name;

  function onOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    setConfirmation("");
  }

  async function onDelete(event: React.FormEvent) {
    event.preventDefault();
    if (!confirmed) {
      return;
    }
    try {
      await deleteProject.mutateAsync(project.id);
    } catch (error) {
      toast.error((error as Error).message);
      return;
    }
    await navigate({ to: "/" });
    queryClient.removeQueries({ queryKey: projectKeys.detail(project.id) });
    toast.success(`Deleted ${project.name}`);
  }

  return (
    <SettingsSection
      title="Delete project"
      description="Permanently deletes this project with all its pages, endpoints, models, and mockups. This can't be undone."
      className="border-destructive/40"
      footer={
        <AlertDialog open={open} onOpenChange={onOpenChange}>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">Delete project</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <form onSubmit={onDelete} className="grid gap-4">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {project.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Everything in this project will be deleted. This can't be
                  undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Field>
                <FieldLabel htmlFor="delete-confirmation">
                  Type <strong>{project.name}</strong> to confirm
                </FieldLabel>
                <Input
                  id="delete-confirmation"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                  autoFocus
                />
              </Field>
              <AlertDialogFooter>
                <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={!confirmed || deleteProject.isPending}
                >
                  Delete project
                </Button>
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        </AlertDialog>
      }
    />
  );
}
