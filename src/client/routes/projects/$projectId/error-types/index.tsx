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
import { CreateErrorTypeDialog } from "@/features/error-types/create-error-type-dialog";
import { errorTypesQueryOptions } from "@/features/error-types/queries";

export const Route = createFileRoute("/projects/$projectId/error-types/")({
  component: ErrorTypesIndex,
});

function ErrorTypesIndex() {
  const { projectId } = Route.useParams();
  const { data: errorTypes } = useSuspenseQuery(
    errorTypesQueryOptions(projectId),
  );
  const empty = errorTypes.length === 0;

  return (
    <Card className="border-dashed">
      <CardHeader className="text-center">
        <CardTitle>
          {empty ? "No error types yet" : "Select an error type"}
        </CardTitle>
        <CardDescription>
          Error types are the errors the API answers with, like sku-taken or
          token-expired: a status, a title, when it happens, and an example.
          Describe each once, and endpoints' responses use it.
        </CardDescription>
      </CardHeader>
      {empty && (
        <CardFooter className="justify-center">
          <CreateErrorTypeDialog
            projectId={projectId}
            trigger={
              <Button>
                <PlusIcon />
                Create an error type
              </Button>
            }
          />
        </CardFooter>
      )}
    </Card>
  );
}
