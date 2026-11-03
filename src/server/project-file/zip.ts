import fs from "node:fs";
import { crc32, inflateRawSync } from "node:zlib";

// A strict reader for zip archives that come from outside (APPNOTE 6.3.10).
// It reads the central directory, checks that every entry's local header
// has the same name, and unpacks an entry only when asked, within the
// caller's limit, then checks its length and CRC-32. Only the central
// directory's sizes and methods are used. Entry names are only compared,
// never used as file-system paths.

export class ZipError extends Error {
  override name = "ZipError";
}

/** Bytes that aren't a zip archive at all. */
export class NotAZipError extends ZipError {
  override name = "NotAZipError";
}

/** An entry that unpacks to more than the caller allows. */
export class ZipLimitError extends ZipError {
  override name = "ZipLimitError";
  readonly entryName: string;
  readonly size: number;
  readonly limit: number;

  constructor(entryName: string, size: number, limit: number) {
    super(`${shown(entryName)} unpacks to more than ${limit} bytes`);
    this.entryName = entryName;
    this.size = size;
    this.limit = limit;
  }
}

/** Random access to the archive's bytes, from memory or from a file. */
export type ZipSource = {
  size: number;
  /** `length` bytes from `offset`, fewer only past the end. */
  read(offset: number, length: number): Uint8Array;
};

export function bufferSource(data: Uint8Array): ZipSource {
  return {
    size: data.length,
    read: (offset, length) =>
      data.subarray(offset, Math.min(data.length, offset + length)),
  };
}

export function fileSource(fd: number): ZipSource {
  const { size } = fs.fstatSync(fd);
  return {
    size,
    read(offset, length) {
      const buffer = Buffer.alloc(
        Math.max(0, Math.min(size, offset + length) - offset),
      );
      let done = 0;
      while (done < buffer.length) {
        const read = fs.readSync(
          fd,
          buffer,
          done,
          buffer.length - done,
          offset + done,
        );
        if (read === 0) {
          break;
        }
        done += read;
      }
      return buffer.subarray(0, done);
    },
  };
}

export type ZipEntry = {
  /** NFC, with forward slashes and no leading `./`; folders end with `/`. */
  name: string;
  directory: boolean;
  /** The unpacked size the central directory declares. */
  size: number;
  compressedSize: number;
  method: number;
  flags: number;
  crc: number;
  dataOffset: number;
};

export type ZipArchive = {
  entries: ZipEntry[];
  get(name: string): ZipEntry | undefined;
  /** The entry's bytes, checked; refused when it unpacks to more than `maxBytes`. */
  read(entry: ZipEntry, maxBytes: number): Uint8Array;
};

const END_SIGNATURE = 0x06054b50;
const END_SIZE = 22;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_LOCATOR_SIZE = 20;
const ZIP64_END_SIGNATURE = 0x06064b50;
const ZIP64_END_SIZE = 56;
const CENTRAL_SIGNATURE = 0x02014b50;
const CENTRAL_SIZE = 46;
const LOCAL_SIGNATURE = 0x04034b50;
const LOCAL_SIZE = 30;
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;
/** Far more than any real central directory, and still little memory. */
const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024;

const FLAG_ENCRYPTED = 0x1;
const FLAG_UTF8 = 0x800;

function shown(name: string) {
  return name.length > 100 ? `${name.slice(0, 97)}…` : name;
}

function damaged(name?: string): never {
  throw new ZipError(
    name === undefined
      ? "This zip is damaged"
      : `${shown(name)} is damaged in this zip`,
  );
}

function notAZip(): never {
  throw new NotAZipError("This file isn't a zip file");
}

function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function u64(data: DataView, offset: number) {
  const value = data.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    damaged();
  }
  return Number(value);
}

// --- Names --------------------------------------------------------------------

// Code page 437, which names without the UTF-8 flag are in (APPNOTE appendix D).
const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
const utf8 = new TextDecoder("utf-8", { fatal: true });

function decodeName(bytes: Uint8Array, flags: number) {
  if (flags & FLAG_UTF8) {
    try {
      return utf8.decode(bytes);
    } catch {
      throw new ZipError("This zip has a file name that isn't valid UTF-8");
    }
  }
  // Without the flag the name should be CP437, but macOS Archive Utility
  // writes UTF-8 and doesn't say so.
  try {
    return utf8.decode(bytes);
  } catch {
    return Array.from(bytes, (byte) =>
      byte < 0x80 ? String.fromCharCode(byte) : (CP437_HIGH[byte - 0x80] ?? ""),
    ).join("");
  }
}

/**
 * The name as entries are looked up: NFC (macOS writes NFD), with `\` as a
 * separator (Windows PowerShell 5.1 writes it) and no leading `./`. Null for
 * the archive's own root folder.
 */
function normalizeName(raw: string) {
  let name = raw.normalize("NFC").replaceAll("\\", "/");
  while (name.startsWith("./")) {
    name = name.slice(2);
  }
  if (name === "" && raw !== "") {
    return null;
  }
  const directory = name.endsWith("/");
  const parts = (directory ? name.slice(0, -1) : name).split("/");
  const unsafe =
    name === "" ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: they're what's refused.
    /[\u0000-\u001f\u007f]/.test(name) ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name) ||
    parts.some((part) => part === "" || part === "." || part === "..");
  if (unsafe) {
    throw new ZipError(
      `This zip has an unsafe file name: ${JSON.stringify(shown(raw))}`,
    );
  }
  return { name, directory };
}

// --- The end records ------------------------------------------------------------

type End = {
  count: number;
  directorySize: number;
  directoryOffset: number;
  /** Where the central directory must end: the ZIP64 record or the end record. */
  limit: number;
};

function findEnd(source: ZipSource): End {
  if (source.size < END_SIZE) {
    notAZip();
  }
  const tailLength = Math.min(source.size, END_SIZE + MAX_U16);
  const tailStart = source.size - tailLength;
  const tail = source.read(tailStart, tailLength);
  const data = view(tail);
  // The record ends the file (its comment reaches the last byte), and its
  // central directory ends where the end records begin. A comment can hold a
  // lookalike, so the last record that fits both wins.
  let failure: ZipError | undefined;
  for (let i = tail.length - END_SIZE; i >= 0; i--) {
    if (
      data.getUint32(i, true) !== END_SIGNATURE ||
      i + END_SIZE + data.getUint16(i + 20, true) !== tail.length
    ) {
      continue;
    }
    try {
      const end = endAt(source, data, i, tailStart + i);
      if (end.directoryOffset + end.directorySize === end.limit) {
        return end;
      }
      failure ??= new ZipError("This zip is damaged");
    } catch (error) {
      if (!(error instanceof ZipError)) {
        throw error;
      }
      failure ??= error;
    }
  }
  if (failure) {
    throw failure;
  }
  notAZip();
}

function endAt(
  source: ZipSource,
  data: DataView,
  position: number,
  endOffset: number,
): End {
  const plain = {
    disk: data.getUint16(position + 4, true),
    directoryDisk: data.getUint16(position + 6, true),
    countOnDisk: data.getUint16(position + 8, true),
    count: data.getUint16(position + 10, true),
    directorySize: data.getUint32(position + 12, true),
    directoryOffset: data.getUint32(position + 16, true),
  };
  const zip64 = readZip64End(source, endOffset);
  const needsZip64 =
    plain.disk === MAX_U16 ||
    plain.directoryDisk === MAX_U16 ||
    plain.countOnDisk === MAX_U16 ||
    plain.count === MAX_U16 ||
    plain.directorySize === MAX_U32 ||
    plain.directoryOffset === MAX_U32;
  if (needsZip64 && !zip64) {
    damaged();
  }

  // A field at its maximum is in the ZIP64 record; any other must agree with
  // it, so no two readers can see different archives.
  const pick = (value: number, max: number, wide: number | undefined) => {
    if (wide === undefined) {
      return value;
    }
    if (value !== max && value !== wide) {
      damaged();
    }
    return wide;
  };
  const disk = pick(plain.disk, MAX_U16, zip64?.disk);
  const directoryDisk = pick(
    plain.directoryDisk,
    MAX_U16,
    zip64?.directoryDisk,
  );
  const countOnDisk = pick(plain.countOnDisk, MAX_U16, zip64?.countOnDisk);
  const count = pick(plain.count, MAX_U16, zip64?.count);
  if (
    disk !== 0 ||
    directoryDisk !== 0 ||
    countOnDisk !== count ||
    (zip64 && zip64.disks > 1)
  ) {
    throw new ZipError(
      "This zip is split into several parts. Import a single .zip file.",
    );
  }
  return {
    count,
    directorySize: pick(plain.directorySize, MAX_U32, zip64?.directorySize),
    directoryOffset: pick(
      plain.directoryOffset,
      MAX_U32,
      zip64?.directoryOffset,
    ),
    limit: zip64 ? zip64.offset : endOffset,
  };
}

function readZip64End(source: ZipSource, endOffset: number) {
  const locatorOffset = endOffset - ZIP64_LOCATOR_SIZE;
  if (locatorOffset < 0) {
    return undefined;
  }
  const locator = view(source.read(locatorOffset, ZIP64_LOCATOR_SIZE));
  if (locator.getUint32(0, true) !== ZIP64_LOCATOR_SIGNATURE) {
    return undefined;
  }
  const offset = u64(locator, 8);
  if (offset + ZIP64_END_SIZE > locatorOffset) {
    damaged();
  }
  const record = view(source.read(offset, ZIP64_END_SIZE));
  if (record.getUint32(0, true) !== ZIP64_END_SIGNATURE) {
    damaged();
  }
  return {
    offset,
    disks: locator.getUint32(16, true),
    disk: record.getUint32(16, true),
    directoryDisk: record.getUint32(20, true),
    countOnDisk: u64(record, 24),
    count: u64(record, 32),
    directorySize: u64(record, 40),
    directoryOffset: u64(record, 48),
  };
}

// --- The central directory ------------------------------------------------------

/** The ZIP64 extended information extra field's data, if the entry has one. */
function zip64Extra(extra: DataView) {
  for (let at = 0; at + 4 <= extra.byteLength; ) {
    const id = extra.getUint16(at, true);
    const length = extra.getUint16(at + 2, true);
    if (at + 4 + length > extra.byteLength) {
      damaged();
    }
    if (id === 0x0001) {
      return new DataView(extra.buffer, extra.byteOffset + at + 4, length);
    }
    at += 4 + length;
  }
  return undefined;
}

export function openZip(
  source: ZipSource,
  { maxEntries }: { maxEntries: number },
): ZipArchive {
  const end = findEnd(source);
  if (end.count > maxEntries) {
    throw new ZipError(
      `This zip has more than ${maxEntries.toLocaleString("en-US")} files`,
    );
  }
  if (
    end.directoryOffset + end.directorySize > end.limit ||
    end.directorySize > MAX_DIRECTORY_BYTES
  ) {
    damaged();
  }
  const directory = source.read(end.directoryOffset, end.directorySize);
  const data = view(directory);

  type Parsed = ZipEntry & { nameBytes: Uint8Array; localOffset: number };
  const parsed: Parsed[] = [];
  let at = 0;
  for (let index = 0; index < end.count; index++) {
    if (
      at + CENTRAL_SIZE > directory.length ||
      data.getUint32(at, true) !== CENTRAL_SIGNATURE
    ) {
      damaged();
    }
    const flags = data.getUint16(at + 8, true);
    const method = data.getUint16(at + 10, true);
    const crc = data.getUint32(at + 16, true);
    let compressedSize = data.getUint32(at + 20, true);
    let size = data.getUint32(at + 24, true);
    const nameLength = data.getUint16(at + 28, true);
    const extraLength = data.getUint16(at + 30, true);
    const commentLength = data.getUint16(at + 32, true);
    let disk = data.getUint16(at + 34, true);
    let localOffset = data.getUint32(at + 42, true);
    const nameStart = at + CENTRAL_SIZE;
    const extraStart = nameStart + nameLength;
    const next = extraStart + extraLength + commentLength;
    if (next > directory.length) {
      damaged();
    }

    // Only the fields at their maximum are in the ZIP64 field, in this order.
    if (
      size === MAX_U32 ||
      compressedSize === MAX_U32 ||
      localOffset === MAX_U32 ||
      disk === MAX_U16
    ) {
      const extra = zip64Extra(
        new DataView(
          directory.buffer,
          directory.byteOffset + extraStart,
          extraLength,
        ),
      );
      if (!extra) {
        damaged();
      }
      let field = 0;
      const take = (bytes: 4 | 8) => {
        if (field + bytes > extra.byteLength) {
          damaged();
        }
        const value =
          bytes === 8 ? u64(extra, field) : extra.getUint32(field, true);
        field += bytes;
        return value;
      };
      if (size === MAX_U32) size = take(8);
      if (compressedSize === MAX_U32) compressedSize = take(8);
      if (localOffset === MAX_U32) localOffset = take(8);
      if (disk === MAX_U16) disk = take(4);
    }
    if (disk !== 0) {
      throw new ZipError(
        "This zip is split into several parts. Import a single .zip file.",
      );
    }

    const nameBytes = directory.subarray(nameStart, extraStart);
    const normalized = normalizeName(decodeName(nameBytes, flags));
    parsed.push({
      name: normalized?.name ?? "",
      directory: normalized ? normalized.directory : true,
      size,
      compressedSize,
      method,
      flags,
      crc,
      dataOffset: 0,
      nameBytes,
      localOffset,
    });
    at = next;
  }
  if (at !== directory.length) {
    damaged();
  }

  // Each local header must have its record's name, and no two entries may
  // share bytes: overlapping entries are how small zips unpack to huge sizes.
  for (const entry of parsed) {
    if (entry.localOffset + LOCAL_SIZE > end.directoryOffset) {
      damaged();
    }
    const header = source.read(entry.localOffset, LOCAL_SIZE);
    const local = view(header);
    if (
      header.length < LOCAL_SIZE ||
      local.getUint32(0, true) !== LOCAL_SIGNATURE
    ) {
      damaged();
    }
    const nameLength = local.getUint16(26, true);
    const extraLength = local.getUint16(28, true);
    const localName = source.read(entry.localOffset + LOCAL_SIZE, nameLength);
    if (
      nameLength !== entry.nameBytes.length ||
      !Buffer.from(localName).equals(Buffer.from(entry.nameBytes))
    ) {
      damaged();
    }
    entry.dataOffset =
      entry.localOffset + LOCAL_SIZE + nameLength + extraLength;
    if (entry.dataOffset + entry.compressedSize > end.directoryOffset) {
      damaged();
    }
  }
  const byOffset = [...parsed].sort((a, b) => a.localOffset - b.localOffset);
  for (let index = 1; index < byOffset.length; index++) {
    const previous = byOffset[index - 1];
    const current = byOffset[index];
    if (
      previous &&
      current &&
      current.localOffset < previous.dataOffset + previous.compressedSize
    ) {
      damaged();
    }
  }

  const entries: ZipEntry[] = [];
  const byName = new Map<string, ZipEntry>();
  for (const { nameBytes: _bytes, localOffset: _offset, ...entry } of parsed) {
    if (entry.name === "") {
      continue; // The root folder, written as "./".
    }
    if (byName.has(entry.name)) {
      throw new ZipError(
        `This zip has a file name twice: ${shown(entry.name)}`,
      );
    }
    byName.set(entry.name, entry);
    entries.push(entry);
  }

  return {
    entries,
    get: (name) => byName.get(name.normalize("NFC")),
    read(entry, maxBytes) {
      if (entry.directory) {
        throw new ZipError(`${shown(entry.name)} is a folder`);
      }
      if (entry.flags & FLAG_ENCRYPTED) {
        throw new ZipError(
          `${shown(entry.name)} is encrypted, and zips with passwords can't be imported`,
        );
      }
      if (entry.method !== 0 && entry.method !== 8) {
        throw new ZipError(
          `${shown(entry.name)} uses compression method ${entry.method}, which isn't supported. Zip the folder again with standard compression.`,
        );
      }
      if (entry.size > maxBytes) {
        throw new ZipLimitError(entry.name, entry.size, maxBytes);
      }
      // The packed bytes are read whole, so they're bounded first: stored
      // data is as long as it unpacks, and deflate never needs more than 9
      // bits a byte (fixed codes) plus block headers.
      const packedLimit =
        entry.method === 0 ? entry.size : entry.size + entry.size / 8 + 1024;
      if (entry.compressedSize > packedLimit) {
        damaged(entry.name);
      }
      const packed = source.read(entry.dataOffset, entry.compressedSize);
      if (packed.length !== entry.compressedSize) {
        damaged(entry.name);
      }
      let unpacked: Uint8Array;
      if (entry.method === 0) {
        if (entry.compressedSize !== entry.size) {
          damaged(entry.name);
        }
        unpacked = packed;
      } else {
        try {
          // Never more than declared, whatever the stream says.
          unpacked = inflateRawSync(packed, {
            maxOutputLength: Math.max(1, entry.size),
          });
        } catch {
          damaged(entry.name);
        }
      }
      if (unpacked.length !== entry.size || crc32(unpacked) !== entry.crc) {
        damaged(entry.name);
      }
      return unpacked;
    },
  };
}
