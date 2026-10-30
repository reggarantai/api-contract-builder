import { useNavigate } from "@tanstack/react-router";
import { SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCreateSampleProject } from "./queries";

/** Adds the sample project and opens it. */
export function CreateSampleButton() {
  const navigate = useNavigate();
  const createSample = useCreateSampleProject();

  // mutateAsync: creating the first project unmounts the empty state.
  async function onClick() {
    try {
      const project = await createSample.mutateAsync();
      toast.success("Created the sample project");
      await navigate({
        to: "/projects/$projectId",
        params: { projectId: project.id },
      });
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <Button
      variant="outline"
      disabled={createSample.isPending}
      onClick={onClick}
    >
      <SparklesIcon />
      {createSample.isPending ? "Creating sample…" : "Create sample project"}
    </Button>
  );
}
