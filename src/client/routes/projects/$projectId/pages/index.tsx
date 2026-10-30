import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CreatePageDialog } from "@/features/pages/create-page-dialog";
import { pagesQueryOptions, useReorderPages } from "@/features/pages/queries";

export const Route = createFileRoute("/projects/$projectId/pages/")({
  component: PageList,
});

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function PageList() {
  const { projectId } = Route.useParams();
  const { data: pages } = useSuspenseQuery(pagesQueryOptions(projectId));
  const reorder = useReorderPages(projectId);

  function move(index: number, offset: -1 | 1) {
    const ids = pages.map((page) => page.id);
    const [moved] = ids.splice(index, 1);
    if (moved) {
      ids.splice(index + offset, 0, moved);
      reorder.mutate(ids, { onError: (error) => toast.error(error.message) });
    }
  }

  if (pages.length === 0) {
    return (
      <Card className="border-dashed">
        <CardHeader className="text-center">
          <CardTitle>No pages yet</CardTitle>
          <CardDescription>
            Write the contract screen by screen: what each page does, how it
            looks, and which endpoints it calls.
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-center">
          <CreatePageDialog
            projectId={projectId}
            trigger={
              <Button>
                <PlusIcon />
                Create a page
              </Button>
            }
          />
        </CardFooter>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <CreatePageDialog
          projectId={projectId}
          trigger={
            <Button>
              <PlusIcon />
              New page
            </Button>
          }
        />
      </div>
      <ol aria-label="Pages" className="divide-y rounded-xl border">
        {pages.map((page, index) => (
          <li key={page.id} className="flex items-center gap-3 px-4 py-3">
            <Link
              to="/projects/$projectId/pages/$pageId"
              params={{ projectId, pageId: page.id }}
              className="font-medium hover:underline"
            >
              {page.name}
            </Link>
            <span className="text-sm text-muted-foreground">
              {plural(page.endpointCount, "endpoint")} ·{" "}
              {plural(page.mockupCount, "mockup")}
            </span>
            <span className="ml-auto flex gap-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${page.name} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${page.name} down`}
                disabled={index === pages.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDownIcon />
              </Button>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
