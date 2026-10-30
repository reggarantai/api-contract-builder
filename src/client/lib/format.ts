const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

const relativeTimeFormat = new Intl.RelativeTimeFormat("en", {
  numeric: "auto",
});

/** "5 minutes ago", "yesterday", … */
export function formatRelativeTime(isoDate: string, now = Date.now()) {
  const seconds = Math.round((new Date(isoDate).getTime() - now) / 1000);
  for (const [unit, unitSeconds] of UNITS) {
    if (Math.abs(seconds) >= unitSeconds) {
      return relativeTimeFormat.format(Math.round(seconds / unitSeconds), unit);
    }
  }
  return "just now";
}

/** The first paragraph of Markdown as plain text, for short previews. */
export function firstParagraph(markdown: string) {
  const [first = ""] = markdown.trim().split(/\n\s*\n/);
  return first
    .replace(/^#+\s+/, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
