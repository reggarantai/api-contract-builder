/** Server data as an editor knows it: the values of its fields, and their revision. */
export type Saved<Values> = { values: Values; revision: number };

/** Plain JSON data, compared by content. */
export function sameValues(a: unknown, b: unknown) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * What an editor does with server data that arrives while it's open:
 *
 * - `ignore`: nothing new, a response that arrived late (revisions only
 *   grow), or a save in progress, which resets the form from its own result;
 * - `take`: replace the form's values, since it has no changes;
 * - `rebase`: keep the changes and move on to the new revision, since only
 *   fields the form doesn't edit changed (another settings section's);
 * - `keep`: keep the changes; saving them gets a conflict to ask about.
 */
export function serverChange<Values>(
  known: Saved<Values>,
  incoming: Saved<Values>,
  form: { saving: boolean; hasChanges: boolean },
): "ignore" | "take" | "rebase" | "keep" {
  if (incoming.revision < known.revision) {
    return "ignore";
  }
  const sameFields = sameValues(incoming.values, known.values);
  if ((incoming.revision === known.revision && sameFields) || form.saving) {
    return "ignore";
  }
  if (!form.hasChanges) {
    return "take";
  }
  return sameFields ? "rebase" : "keep";
}
