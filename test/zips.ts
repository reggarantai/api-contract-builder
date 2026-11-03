import { crc32, deflateRawSync } from "node:zlib";

// Zip archives built byte by byte, so tests can produce what real tools and
// attackers do: odd names, lying sizes, overlapping entries, ZIP64 records.

export type CraftedEntry = {
  /** A string is written as UTF-8; bytes are written as they are. */
  name: string | Uint8Array;
  data?: Uint8Array | string;
  /** 0 stores, 8 deflates; anything else is written as the method number. */
  method?: number;
  /** Extra general purpose flags; bit 11 (UTF-8) comes from `utf8Flag`. */
  flags?: number;
  /** Sets bit 11; by default only for names with non-ASCII characters. */
  utf8Flag?: boolean;
  /** The bytes after the local header, instead of compressing `data`. */
  compressed?: Uint8Array;
  /** Values written in place of the real ones. */
  crc?: number;
  compressedSize?: number;
  uncompressedSize?: number;
  /** A different name, or signature, in the local header. */
  localName?: string | Uint8Array;
  localSignature?: number;
  /** Points the central record at another entry's local header. */
  localHeaderOf?: number;
  /** Sizes and offset in a ZIP64 extra field, with 0xFFFFFFFF in the record. */
  zip64?: boolean;
  /** Zero sizes in the local header and a data descriptor after the data. */
  dataDescriptor?: boolean;
};

export type CraftOptions = {
  comment?: string | Uint8Array;
  /** Disk numbers in the end record; 0 for a single-disk archive. */
  disk?: number;
  /** The number of entries the end record claims. */
  count?: number;
  /** Writes ZIP64 end records, with 0xFFFF and 0xFFFFFFFF in the plain one. */
  zip64?: boolean;
  /** Bytes between the last entry and the central directory. */
  gap?: Uint8Array;
};

const encoder = new TextEncoder();

function bytesOf(value: string | Uint8Array) {
  return typeof value === "string" ? encoder.encode(value) : value;
}

class Writer {
  private chunks: Uint8Array[] = [];
  length = 0;

  bytes(data: Uint8Array) {
    this.chunks.push(data);
    this.length += data.length;
  }
  u16(value: number) {
    const buffer = Buffer.alloc(2);
    buffer.writeUInt16LE(value);
    this.bytes(buffer);
  }
  u32(value: number) {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value >>> 0);
    this.bytes(buffer);
  }
  u64(value: number) {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(BigInt(value));
    this.bytes(buffer);
  }
  result() {
    return new Uint8Array(Buffer.concat(this.chunks));
  }
}

export function craftZip(
  entries: CraftedEntry[],
  options: CraftOptions = {},
): Uint8Array {
  const out = new Writer();
  const written = entries.map((entry) => {
    const name = bytesOf(entry.name);
    const data = bytesOf(entry.data ?? "");
    const method = entry.method ?? 0;
    const compressed =
      entry.compressed ?? (method === 8 ? deflateRawSync(data) : data);
    const utf8 =
      entry.utf8Flag ??
      (typeof entry.name === "string" &&
        [...entry.name].some((char) => (char.codePointAt(0) ?? 0) > 0x7f));
    const flags =
      (entry.flags ?? 0) |
      (utf8 ? 0x800 : 0) |
      (entry.dataDescriptor ? 0x8 : 0);
    const crc = entry.crc ?? crc32(data);
    const compressedSize = entry.compressedSize ?? compressed.length;
    const uncompressedSize = entry.uncompressedSize ?? data.length;
    const offset = out.length;

    const localName = bytesOf(entry.localName ?? name);
    out.u32(entry.localSignature ?? 0x04034b50);
    out.u16(entry.zip64 ? 45 : 20);
    out.u16(flags);
    out.u16(method);
    out.u16(0); // time
    out.u16(0x21); // date: 1980-01-01
    out.u32(entry.dataDescriptor ? 0 : crc);
    out.u32(entry.dataDescriptor ? 0 : compressedSize);
    out.u32(entry.dataDescriptor ? 0 : uncompressedSize);
    out.u16(localName.length);
    out.u16(0);
    out.bytes(localName);
    out.bytes(compressed);
    if (entry.dataDescriptor) {
      out.u32(0x08074b50);
      out.u32(crc);
      out.u32(compressedSize);
      out.u32(uncompressedSize);
    }
    return {
      entry,
      name,
      method,
      flags,
      crc,
      compressedSize,
      uncompressedSize,
      offset,
    };
  });

  out.bytes(options.gap ?? new Uint8Array());
  const directoryOffset = out.length;
  for (const item of written) {
    const { entry } = item;
    const offset =
      entry.localHeaderOf === undefined
        ? item.offset
        : (written[entry.localHeaderOf]?.offset ?? 0);
    const extra = new Writer();
    if (entry.zip64) {
      extra.u16(0x0001);
      extra.u16(24);
      extra.u64(item.uncompressedSize);
      extra.u64(item.compressedSize);
      extra.u64(offset);
    }
    const extraBytes = extra.result();
    out.u32(0x02014b50);
    out.u16(entry.zip64 ? 45 : 20);
    out.u16(entry.zip64 ? 45 : 20);
    out.u16(item.flags);
    out.u16(item.method);
    out.u16(0);
    out.u16(0x21);
    out.u32(item.crc);
    out.u32(entry.zip64 ? 0xffffffff : item.compressedSize);
    out.u32(entry.zip64 ? 0xffffffff : item.uncompressedSize);
    out.u16(item.name.length);
    out.u16(extraBytes.length);
    out.u16(0); // comment
    out.u16(0); // disk
    out.u16(0); // internal attributes
    out.u32(0); // external attributes
    out.u32(entry.zip64 ? 0xffffffff : offset);
    out.bytes(item.name);
    out.bytes(extraBytes);
  }
  const directorySize = out.length - directoryOffset;
  const count = options.count ?? entries.length;
  const disk = options.disk ?? 0;

  if (options.zip64) {
    const recordOffset = out.length;
    out.u32(0x06064b50);
    out.u64(44);
    out.u16(45);
    out.u16(45);
    out.u32(disk);
    out.u32(disk);
    out.u64(count);
    out.u64(count);
    out.u64(directorySize);
    out.u64(directoryOffset);
    out.u32(0x07064b50);
    out.u32(0);
    out.u64(recordOffset);
    out.u32(1);
  }
  const comment = bytesOf(options.comment ?? "");
  out.u32(0x06054b50);
  out.u16(options.zip64 ? 0xffff : disk);
  out.u16(options.zip64 ? 0xffff : disk);
  out.u16(options.zip64 ? 0xffff : Math.min(count, 0xffff));
  out.u16(options.zip64 ? 0xffff : Math.min(count, 0xffff));
  out.u32(options.zip64 ? 0xffffffff : directorySize);
  out.u32(options.zip64 ? 0xffffffff : directoryOffset);
  out.u16(comment.length);
  out.bytes(comment);
  return out.result();
}
