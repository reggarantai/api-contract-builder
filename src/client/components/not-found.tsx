import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function NotFound() {
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="font-heading text-xl font-semibold">Not found</h1>
      <p className="text-sm text-muted-foreground">
        This page or project doesn't exist. It may have been deleted.
      </p>
      <Button asChild variant="outline">
        <Link to="/">Back to projects</Link>
      </Button>
    </div>
  );
}
