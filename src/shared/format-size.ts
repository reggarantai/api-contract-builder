const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

/** "1000 bytes", "20 KB", "1.5 MB", "1 GB": binary units, as the size settings are. */
export function formatSize(bytes: number) {
  if (bytes < KB) {
    return `${bytes} byte${bytes === 1 ? "" : "s"}`;
  }
  if (bytes < MB) {
    return `${Math.round(bytes / KB)} KB`;
  }
  if (bytes < GB) {
    return `${Math.round((bytes / MB) * 10) / 10} MB`;
  }
  return `${Math.round((bytes / GB) * 10) / 10} GB`;
}
