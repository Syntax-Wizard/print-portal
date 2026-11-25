import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crc32, createZip, uniqueNames } from "../src/util/zip";

describe("zip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("makes names unique without losing the extension", () => {
    expect(uniqueNames(["a.pdf", "A.pdf", "a.pdf", "b"])).toEqual(["a.pdf", "A (2).pdf", "a (3).pdf", "b"]);
  });

  it("writes an archive that the system unzip accepts, with Japanese names intact", async () => {
    const files = [
      { name: "ゼミ資料 第3回.pdf", data: new TextEncoder().encode("%PDF-1.4 first") },
      { name: "20261125155253.pdf", data: new TextEncoder().encode("%PDF-1.4 second") },
    ];
    const dir = mkdtempSync(join(tmpdir(), "zip-test-"));
    const path = join(dir, "test.zip");
    writeFileSync(path, new Uint8Array(await createZip(files).arrayBuffer()));
    // Python's zipfile honours the UTF-8 flag like Finder and Windows Explorer do (macOS's
    // bundled command-line unzip 6.00 from 2009 does not) and checks every entry's CRC.
    const check = `import zipfile,sys,json
z = zipfile.ZipFile(sys.argv[1])
print(json.dumps({"bad": z.testzip(), "names": z.namelist(), "first": z.read(z.namelist()[0]).decode()}))`;
    const result = JSON.parse(execFileSync("python3", ["-I", "-c", check, path], { encoding: "utf-8" }));
    expect(result).toEqual({ bad: null, names: ["ゼミ資料 第3回.pdf", "20261125155253.pdf"], first: "%PDF-1.4 first" });
  });
});
