import { useEffect, useEffectEvent, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { ApiError } from "./api";
import { type Saved, serverChange } from "./server-changes";

/** Why a form gets new values. */
export type ResetReason =
  /** Its own save went through. */
  | "saved"
  /** The item changed elsewhere while the form had no changes. */
  | "changed"
  /** The user discarded their changes. */
  | "discarded"
  /** The user loaded the version saved elsewhere. */
  | "loaded";

/**
 * Keeps an editor's form in step with the server without losing unsaved
 * changes, and without saving over a newer save made elsewhere:
 *
 * - server data replaces the form only while it has no changes (see
 *   `serverChange`), and a save resets it from what was saved;
 * - the form remembers the revision its values come from, and saves send it;
 * - a save refused for an older revision becomes a conflict, which the editor
 *   shows with `ConflictDialog`: keep editing, load the saved version, or
 *   save over it, which holds until a save goes through;
 * - while it saves or loads, `busy` is true, and the editor makes the form
 *   inert, so nothing typed then is lost to the reset that follows.
 */
export function useSavedForm<Values, Input>(options: {
  /** The server's values of the fields the form edits. */
  values: Values;
  /** The server's revision of what the form edits. */
  revision: number;
  /** Unsaved changes, including text that doesn't parse yet. */
  hasChanges: () => boolean;
  /** Gives the form these values; nested editors reload unless it's a save. */
  reset: (values: Values, reason: ResetReason) => void;
  /** Saves `input` as based on `revision`, and gives back what was saved. */
  send: (input: Input, revision: number) => Promise<Saved<Values>>;
  /** Fetches the version saved now. */
  load: () => Promise<Saved<Values>>;
  onSaved: () => void;
  /** A failed save, other than a conflict. */
  onError: (error: Error, input: Input) => void;
  /** A save refused for an older revision; the conflict dialog opens. */
  onConflict?: () => void;
}) {
  const { values, revision } = options;
  const base = useRef<Saved<Values>>({ values, revision });
  // The newer revision the user chose to save over, until a save goes through.
  const overwrite = useRef<number | null>(null);
  const saving = useRef(false);
  const [conflict, setConflict] = useState<{
    input: Input;
    revision: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const refocus = useRef<HTMLElement | null>(null);

  const receive = useEffectEvent((incoming: Saved<Values>) => {
    const change = serverChange(base.current, incoming, {
      saving: saving.current,
      hasChanges: options.hasChanges(),
    });
    if (change === "take") {
      options.reset(incoming.values, "changed");
    }
    if (change === "take" || change === "rebase") {
      base.current = incoming;
      overwrite.current = null;
    }
  });
  useEffect(() => {
    receive({ values, revision });
  }, [values, revision]);

  // The form is inert while busy, which takes the focus away; give it back.
  useEffect(() => {
    if (!busy && refocus.current) {
      if (refocus.current.isConnected) {
        refocus.current.focus();
      }
      refocus.current = null;
    }
  }, [busy]);

  /** Locks the form at once, before another keystroke can reach it. */
  function lock() {
    flushSync(() => setBusy(true));
  }

  function took(saved: Saved<Values>) {
    base.current = saved;
    overwrite.current = null;
    setConflict(null);
  }

  async function save(input: Input) {
    const focused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    saving.current = true;
    lock();
    try {
      const saved = await options.send(
        input,
        overwrite.current ?? base.current.revision,
      );
      options.reset(saved.values, "saved");
      took(saved);
      refocus.current = focused;
      options.onSaved();
    } catch (error) {
      if (error instanceof ApiError && error.revision !== undefined) {
        setConflict({ input, revision: error.revision });
        options.onConflict?.();
      } else {
        setConflict(null);
        options.onError(error as Error, input);
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  async function load() {
    lock();
    try {
      const saved = await options.load();
      options.reset(saved.values, "loaded");
      took(saved);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return {
    save,
    busy,
    /** Drops the form's changes for what the server has now. */
    discard() {
      options.reset(values, "discarded");
      took({ values, revision });
    },
    conflict: {
      open: conflict !== null,
      busy,
      onKeep: () => setConflict(null),
      onLoad: load,
      onOverwrite: () => {
        if (conflict) {
          overwrite.current = conflict.revision;
          void save(conflict.input);
        }
      },
    },
  };
}
