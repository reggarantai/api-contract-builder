import type { ErrorComponentProps } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function RouteError({ error, reset }: ErrorComponentProps) {
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="font-heading text-xl font-semibold">
        Something went wrong
      </h1>
      <p className="text-sm text-muted-foreground">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <Button variant="outline" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
