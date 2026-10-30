import { json, jsonParseLinter } from "@codemirror/lang-json";
import { linter, lintGutter } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

// Long schemas scroll inside the editor so the Save button stays close.
const theme = EditorView.theme({
  "&": { fontSize: "13px", maxHeight: "70vh" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", minHeight: "18rem" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none" },
});

/**
 * A CodeMirror JSON editor. `value` is only read on mount; remount it (with
 * a `key`) to load different text.
 */
export default function JsonCodeEditor({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: the editor owns its text after mount (see the doc comment).
  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) {
      return;
    }
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          json(),
          linter(jsonParseLinter()),
          lintGutter(),
          theme,
          EditorView.contentAttributes.of({ "aria-label": label }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    return () => view.destroy();
  }, []);

  return (
    <div
      ref={containerRef}
      className="overflow-hidden rounded-lg border focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
    />
  );
}
