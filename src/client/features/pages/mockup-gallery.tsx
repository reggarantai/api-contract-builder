import type { Mockup } from "@shared/pages";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

function labelOf(mockup: Mockup) {
  return mockup.caption || mockup.originalName;
}

/** Mockup thumbnails that open a full-size lightbox. */
export function MockupGallery({ mockups }: { mockups: Mockup[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const current = openIndex === null ? undefined : mockups[openIndex];

  function show(offset: -1 | 1) {
    setOpenIndex((index) =>
      index === null
        ? index
        : (index + offset + mockups.length) % mockups.length,
    );
  }

  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {mockups.map((mockup, index) => (
          <li key={mockup.id} className="grid gap-1.5">
            <button
              type="button"
              aria-label={`Open ${labelOf(mockup)}`}
              className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border bg-muted transition-opacity hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => setOpenIndex(index)}
            >
              <img
                src={mockup.url}
                alt=""
                className="max-h-full max-w-full object-contain"
              />
            </button>
            {mockup.caption && (
              <p className="text-sm text-muted-foreground">{mockup.caption}</p>
            )}
          </li>
        ))}
      </ul>

      <Dialog
        open={current !== undefined}
        onOpenChange={(open) => !open && setOpenIndex(null)}
      >
        {current && openIndex !== null && (
          <DialogContent
            className="grid max-w-[min(90vw,72rem)] gap-3 sm:max-w-[min(90vw,72rem)]"
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                show(1);
              } else if (event.key === "ArrowLeft") {
                show(-1);
              }
            }}
          >
            <DialogTitle>{labelOf(current)}</DialogTitle>
            <DialogDescription>
              {openIndex + 1} of {mockups.length} · {current.width}×
              {current.height}
            </DialogDescription>
            <div className="flex items-center justify-center overflow-hidden rounded-md bg-muted">
              <img
                src={current.url}
                alt={labelOf(current)}
                className="max-h-[70vh] max-w-full object-contain"
              />
            </div>
            {mockups.length > 1 && (
              <div className="flex justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Previous mockup"
                  onClick={() => show(-1)}
                >
                  <ChevronLeftIcon />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Next mockup"
                  onClick={() => show(1)}
                >
                  Next
                  <ChevronRightIcon />
                </Button>
              </div>
            )}
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
