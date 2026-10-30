import { createFileRoute } from "@tanstack/react-router";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold">Projects</h1>
      <Card className="border-dashed">
        <CardHeader className="text-center">
          <CardTitle>No projects yet</CardTitle>
          <CardDescription>
            Create a project to start writing API contracts page by page.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
