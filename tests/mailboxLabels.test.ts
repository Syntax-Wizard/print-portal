import { beforeEach, describe, expect, it } from "vitest";
import { downloadName, loadLabels, pruneLabels, saveLabel } from "../src/ui/mailboxLabels";

beforeEach(() => {
  const data = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    length: 0,
  };
});

describe("mailbox display names", () => {
  it("saves, trims and removes names per box", () => {
    saveLabel(27, "20261125155253", "  Lab   meeting  ");
    saveLabel(3, "20261125155253", "Other box");
    expect(loadLabels(27)).toEqual({ "20261125155253": "Lab meeting" });
    saveLabel(27, "20261125155253", "   ");
    expect(loadLabels(27)).toEqual({});
    expect(loadLabels(3)).toEqual({ "20261125155253": "Other box" });
  });

  it("forgets names of documents that were deleted", () => {
    saveLabel(27, "a", "A");
    saveLabel(27, "b", "B");
    expect(pruneLabels(27, ["b"])).toEqual({ b: "B" });
    expect(loadLabels(27)).toEqual({ b: "B" });
  });

  it("makes safe download names and keeps the extension", () => {
    expect(downloadName(undefined, "20261125155253.pdf")).toBe("20261125155253.pdf");
    expect(downloadName("ゼミ資料: 第3回", "20261125155253.pdf")).toBe("ゼミ資料_ 第3回.pdf");
    expect(downloadName("a/b\\c?.", "x.tif")).toBe("a_b_c_..tif");
    expect(downloadName("...", "x.pdf")).toBe("document.pdf");
  });
});
