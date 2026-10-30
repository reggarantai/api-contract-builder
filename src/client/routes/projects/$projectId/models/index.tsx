import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CreateModelDialog } from "@/features/models/create-model-dialog";
import { modelsQueryOptions } from "@/features/models/queries";

export const Route = createFileRoute("/projects/$projectId/models/")({
  component: ModelsIndex,
});

function ModelsIndex() {
  const { projectId } = Route.useParams();
  const { data: models } = useSuspenseQuery(modelsQueryOptions(projectId));
  const empty = models.length === 0;

  return (
    <Card className="border-dashed">
      <CardHeader className="text-center">
        <CardTitle>{empty ? "No models yet" : "Select a model"}</CardTitle>
        <CardDescription>
          Models are reusable schemas, like User or Order. Endpoints and other
          models reference them, so a change in one place applies everywhere.
        </CardDescription>
      </CardHeader>
      {empty && (
        <CardFooter className="justify-center">
          <CreateModelDialog
            projectId={projectId}
            trigger={
              <Button>
                <PlusIcon />
                Create a model
              </Button>
            }
          />
        </CardFooter>
      )}
    </Card>
  );
}
