import fs from "node:fs";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { strToU8, Zip, ZipDeflate, ZipPassThrough, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { type CraftedEntry, craftZip } from "../../../test/zips";
import {
  bufferSource,
  openZip,
  type ZipArchive,
  ZipError,
  ZipLimitError,
} from "./zip";

const MAX_ENTRIES = 50;
const open = (data: Uint8Array, maxEntries = MAX_ENTRIES) =>
  openZip(bufferSource(data), { maxEntries });

function text(archive: ZipArchive, name: string, maxBytes = 1024 * 1024) {
  const entry = archive.get(name);
  if (!entry) {
    throw new Error(`${name} isn't in the archive`);
  }
  return Buffer.from(archive.read(entry, maxBytes)).toString("utf8");
}

function refusal(action: () => unknown) {
  try {
    action();
  } catch (error) {
    if (error instanceof ZipError) {
      return error.message;
    }
    throw error;
  }
  throw new Error("Expected a ZipError");
}

function readAll(archive: ZipArchive) {
  for (const entry of archive.entries) {
    if (!entry.directory) {
      archive.read(entry, 1024 * 1024);
    }
  }
}

describe("reading zip archives", () => {
  it("reads stored and deflated entries written by fflate", () => {
    const zip = zipSync({
      "shop/project.json": [strToU8('{"a":1}'), { level: 6 }],
      "shop/mockups/a.png": [new Uint8Array([1, 2, 3]), { level: 0 }],
    });
    const archive = open(zip);

    expect(archive.entries.map((entry) => entry.name)).toEqual([
      "shop/project.json",
      "shop/mockups/a.png",
    ]);
    expect(text(archive, "shop/project.json")).toBe('{"a":1}');
    const image = archive.get("shop/mockups/a.png");
    expect(image?.size).toBe(3);
    expect(image && [...archive.read(image, 3)]).toEqual([1, 2, 3]);
  });

  it("reads archives streamed with data descriptors", () => {
    const chunks: Uint8Array[] = [];
    const zip = new Zip((error, chunk) => {
      if (error) throw error;
      chunks.push(chunk);
    });
    const json = new ZipDeflate("project.json", { level: 6 });
    zip.add(json);
    json.push(strToU8('{"b":2}'), true);
    const image = new ZipPassThrough("mockups/a.png");
    zip.add(image);
    image.push(new Uint8Array([9, 8]), true);
    zip.end();

    const archive = open(new Uint8Array(Buffer.concat(chunks)));

    expect(text(archive, "project.json")).toBe('{"b":2}');
    expect(archive.get("mockups/a.png")?.size).toBe(2);
  });

  it("reads empty entries, stored and deflated", () => {
    const archive = open(
      craftZip([
        { name: "empty.txt", data: "" },
        { name: "empty-deflated.txt", data: "", method: 8 },
      ]),
    );
    expect(text(archive, "empty.txt")).toBe("");
    expect(text(archive, "empty-deflated.txt")).toBe("");
  });

  it("finds the end record after a comment, and not one inside it", () => {
    const decoy = craftZip([{ name: "decoy.txt", data: "decoy" }]);
    const archive = open(
      craftZip([{ name: "real.txt", data: "real" }], {
        comment: decoy.slice(decoy.length - 22),
      }),
    );
    expect(archive.entries.map((entry) => entry.name)).toEqual(["real.txt"]);
  });

  it("reads ZIP64 records", () => {
    const archive = open(
      craftZip(
        [
          { name: "a.txt", data: "first", zip64: true },
          { name: "b.txt", data: "second", method: 8, zip64: true },
        ],
        { zip64: true },
      ),
    );
    expect(text(archive, "a.txt")).toBe("first");
    expect(text(archive, "b.txt")).toBe("second");
  });

  describe("archives from real tools", () => {
    const dir = path.resolve("test/fixtures/project-file-v1-zips");
    const expected = fs.readFileSync(
      path.resolve("test/fixtures/project-file-v1/project.json"),
      "utf8",
    );

    it.each([
      ["ditto.zip", "project-file-v1/"], // macOS Finder's Compress
      ["zip-r.zip", "project-file-v1/"], // Info-ZIP
      ["zip-fz.zip", "project-file-v1/"], // Info-ZIP with forced ZIP64
      ["bsdtar.zip", "project-file-v1/"], // libarchive
      ["python.zip", ""], // Python's zipfile, names at the top
    ])("reads %s", (file, folder) => {
      const archive = open(new Uint8Array(fs.readFileSync(`${dir}/${file}`)));

      expect(text(archive, `${folder}project.json`)).toBe(expected);
      const image = archive.get(`${folder}mockups/items.png`);
      expect(image && archive.read(image, 1024).length).toBe(72);
      readAll(archive);
    });

    it("skips folders and sees __MACOSX files as files", () => {
      const archive = open(new Uint8Array(fs.readFileSync(`${dir}/ditto.zip`)));
      expect(archive.get("project-file-v1/")?.directory).toBe(true);
      expect(archive.get("__MACOSX/project-file-v1/._project.json")).toEqual(
        expect.objectContaining({ directory: false }),
      );
    });
  });

  describe("names", () => {
    const names = (entries: CraftedEntry[]) =>
      open(craftZip(entries)).entries.map((entry) => entry.name);

    it("decodes UTF-8 names, with or without the UTF-8 flag", () => {
      expect(
        names([
          { name: "café.png", utf8Flag: true },
          // macOS Archive Utility writes UTF-8 without the flag.
          { name: "naïve.png", utf8Flag: false },
        ]),
      ).toEqual(["café.png", "naïve.png"]);
    });

    it("decodes other names without the UTF-8 flag as CP437", () => {
      expect(
        names([{ name: new Uint8Array([0x63, 0x61, 0x66, 0x82]) }]),
      ).toEqual(["café"]);
    });

    it("refuses a flagged name that isn't UTF-8", () => {
      expect(
        refusal(() =>
          open(
            craftZip([{ name: new Uint8Array([0x61, 0xff]), utf8Flag: true }]),
          ),
        ),
      ).toMatch(/isn't valid UTF-8/);
    });

    it("normalizes names to NFC", () => {
      const archive = open(craftZip([{ name: "cafe\u0301.png", data: "x" }]));
      expect(archive.get("caf\u00e9.png")).toBeDefined();
    });

    it("reads backslashes as folder separators and drops a leading ./", () => {
      // Windows PowerShell 5.1 writes backslashes.
      expect(
        names([
          { name: "shop\\mockups\\a.png" },
          { name: "./shop/project.json" },
        ]),
      ).toEqual(["shop/mockups/a.png", "shop/project.json"]);
    });

    it.each([
      "../evil.png",
      "shop/../../evil.png",
      "shop\\..\\evil.png",
      "/etc/passwd",
      "\\\\server\\share\\a.png",
      "C:/evil.png",
      "c:evil.png",
      "shop//a.png",
      "shop/./a.png",
      ".",
      "",
      "shop/a\u0000.png",
      "shop/a\u001b.png",
      "shop/a\u007f.png",
    ])("refuses the unsafe name %j", (name) => {
      expect(refusal(() => open(craftZip([{ name, data: "x" }])))).toMatch(
        /file name/,
      );
    });

    it("refuses two entries with the same name", () => {
      expect(
        refusal(() =>
          open(
            craftZip([{ name: "a.png" }, { name: "b.png" }, { name: "a.png" }]),
          ),
        ),
      ).toMatch(/twice: a\.png/);
    });

    it("refuses names that only look different", () => {
      expect(
        refusal(() =>
          open(craftZip([{ name: "shop/a.png" }, { name: "shop\\a.png" }])),
        ),
      ).toMatch(/twice/);
      expect(
        refusal(() =>
          open(craftZip([{ name: "caf\u00e9" }, { name: "cafe\u0301" }])),
        ),
      ).toMatch(/twice/);
    });

    it("cuts long names in messages", () => {
      const message = refusal(() =>
        open(craftZip([{ name: `${"a".repeat(500)}/../x` }])),
      );
      expect(message.length).toBeLessThan(250);
    });
  });

  describe("structure", () => {
    it.each([
      ["no bytes", new Uint8Array()],
      ["text", strToU8("openapi: 3.1.0\ninfo:\n  title: x\n")],
      ["a PNG", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])],
    ])("refuses %s as not a zip", (_, data) => {
      expect(refusal(() => open(data))).toMatch(/isn't a zip/);
    });

    it("refuses a cut-off archive", () => {
      const zip = craftZip([{ name: "a.txt", data: "hello world" }]);
      expect(refusal(() => open(zip.slice(0, zip.length - 5)))).toMatch(
        /isn't a zip|damaged/,
      );
      expect(refusal(() => open(zip.slice(10)))).toMatch(/isn't a zip|damaged/);
    });

    it("refuses archives split over several disks", () => {
      expect(
        refusal(() => open(craftZip([{ name: "a.txt" }], { disk: 1 }))),
      ).toMatch(/several parts/);
    });

    it("refuses more entries than allowed before reading them", () => {
      // The end record claims far more entries than the archive holds.
      expect(
        refusal(() => open(craftZip([{ name: "a.txt" }], { count: 60_000 }))),
      ).toMatch(/more than 50 files/);
      expect(
        refusal(() =>
          open(
            craftZip(
              Array.from({ length: 51 }, (_, index) => ({ name: `${index}` })),
            ),
          ),
        ),
      ).toMatch(/more than 50 files/);
    });

    it("refuses a central directory that doesn't match its count", () => {
      expect(
        refusal(() =>
          open(craftZip([{ name: "a.txt" }, { name: "b.txt" }], { count: 1 })),
        ),
      ).toMatch(/damaged/);
    });

    it("refuses a local header without the central record's name", () => {
      expect(
        refusal(() => open(craftZip([{ name: "a.txt", localName: "b.txt" }]))),
      ).toMatch(/damaged/);
      expect(
        refusal(() =>
          open(craftZip([{ name: "a.txt", localSignature: 0x12345678 }])),
        ),
      ).toMatch(/damaged/);
    });

    it("refuses entries that share their bytes", () => {
      // The classic overlapping-files zip bomb: many records, one payload.
      expect(
        refusal(() =>
          open(
            craftZip([
              { name: "a.txt", data: "payload" },
              { name: "b.txt", data: "other", localHeaderOf: 0 },
            ]),
          ),
        ),
      ).toMatch(/damaged/);
    });

    it("refuses ZIP64 values that disagree with the plain record", () => {
      const zip = craftZip([{ name: "a.txt", data: "x" }], { zip64: true });
      // The plain record's entry count says 2; the ZIP64 record says 1.
      const end = zip.length - 22;
      Buffer.from(zip.buffer, zip.byteOffset).writeUInt16LE(2, end + 10);
      expect(refusal(() => open(zip))).toMatch(/damaged/);
    });
  });

  describe("reading an entry", () => {
    function readOnly(entry: CraftedEntry, maxBytes = 1024) {
      const archive = open(craftZip([entry]));
      const found = archive.entries[0];
      if (!found) throw new Error("no entry");
      return archive.read(found, maxBytes);
    }

    it("refuses an entry larger than the caller allows, before unpacking it", () => {
      const huge = craftZip([
        {
          name: "bomb.json",
          method: 8,
          compressed: deflateRawSync(Buffer.alloc(10)),
          uncompressedSize: 0xfffffff0,
        },
      ]);
      const archive = open(huge);
      const entry = archive.entries[0];
      expect(entry).toBeDefined();
      let error: unknown;
      try {
        if (entry) archive.read(entry, 1024 * 1024);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ZipLimitError);
      expect(error).toMatchObject({
        entryName: "bomb.json",
        size: 0xfffffff0,
        limit: 1024 * 1024,
      });
    });

    it("checks an entry's packed size before reading it", () => {
      for (const method of [0, 8]) {
        const zip = craftZip([
          {
            name: "a.png",
            method,
            // A megabyte of packed bytes for 100 unpacked ones.
            compressed: new Uint8Array(1024 * 1024),
            uncompressedSize: 100,
          },
        ]);
        const source = bufferSource(zip);
        let largest = 0;
        const watched = {
          size: source.size,
          read(offset: number, length: number) {
            largest = Math.max(largest, length);
            return source.read(offset, length);
          },
        };
        const archive = openZip(watched, { maxEntries: 10 });
        const entry = archive.entries[0];
        expect(
          refusal(() => entry && archive.read(entry, 1024)),
          `method ${method}`,
        ).toMatch(/a\.png is damaged/);
        // The end record search reads the last 64 KB; nothing reads the megabyte.
        expect(largest, `method ${method}`).toBeLessThan(70_000);
      }
    });

    it("refuses deflated data longer than declared", () => {
      expect(
        refusal(() =>
          readOnly({
            name: "a.txt",
            method: 8,
            compressed: deflateRawSync(Buffer.alloc(5000)),
            uncompressedSize: 100,
            crc: crc32(Buffer.alloc(100)),
          }),
        ),
      ).toMatch(/a\.txt is damaged/);
    });

    it("refuses deflated data shorter than declared", () => {
      expect(
        refusal(() =>
          readOnly({
            name: "a.txt",
            method: 8,
            compressed: deflateRawSync(Buffer.alloc(10)),
            uncompressedSize: 100,
          }),
        ),
      ).toMatch(/a\.txt is damaged/);
    });

    it("refuses stored data whose sizes differ", () => {
      expect(
        refusal(() =>
          readOnly({ name: "a.txt", data: "hello", uncompressedSize: 4 }),
        ),
      ).toMatch(/a\.txt is damaged/);
    });

    it("checks the CRC-32 of stored and deflated data", () => {
      for (const method of [0, 8]) {
        expect(
          refusal(() =>
            readOnly({ name: "a.txt", data: "hello", method, crc: 1234 }),
          ),
        ).toMatch(/a\.txt is damaged/);
      }
    });

    it("refuses broken deflate data", () => {
      expect(
        refusal(() =>
          readOnly({
            name: "a.txt",
            method: 8,
            compressed: new Uint8Array([0xff, 0xff, 0xff, 0xff]),
            uncompressedSize: 4,
          }),
        ),
      ).toMatch(/a\.txt is damaged/);
    });

    it("refuses encrypted entries", () => {
      expect(
        refusal(() => readOnly({ name: "a.txt", data: "x", flags: 0x1 })),
      ).toMatch(/a\.txt is encrypted/);
    });

    it("refuses compression methods other than store and deflate", () => {
      expect(
        refusal(() => readOnly({ name: "a.txt", data: "x", method: 12 })),
      ).toMatch(/a\.txt uses compression method 12/);
    });
  });

  it("answers mutated archives with its own refusal, or reads them correctly", () => {
    const valid = zipSync({
      "shop/project.json": [
        strToU8(JSON.stringify({ hello: "world".repeat(50) })),
        { level: 6 },
      ],
      "shop/mockups/a.png": [new Uint8Array(200).fill(7), { level: 0 }],
      "shop/mockups/b.png": [new Uint8Array(300).fill(3), { level: 9 }],
    });
    let seed = 42;
    const random = (limit: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % limit;
    };
    for (let round = 0; round < 3000; round++) {
      const data = valid.slice();
      const changes = 1 + random(4);
      for (let change = 0; change < changes; change++) {
        data[random(data.length)] = random(256);
      }
      const cut = round % 7 === 0 ? data.slice(0, random(data.length)) : data;
      try {
        const archive = open(cut, 10);
        for (const entry of archive.entries) {
          if (!entry.directory) {
            const bytes = archive.read(entry, 4096);
            expect(bytes.length).toBe(entry.size);
          }
        }
      } catch (error) {
        if (!(error instanceof ZipError)) {
          throw new Error(`Round ${round} threw ${String(error)}`);
        }
      }
    }
  });
});
