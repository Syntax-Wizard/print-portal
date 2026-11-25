import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, toFormFields, validateOptions } from "../src/printer/options";
import type { PrintOptions } from "../src/printer/types";

const fields = (o: PrintOptions) => Object.fromEntries(toFormFields(o));

describe("toFormFields", () => {
  it("encodes the lab defaults", () => {
    expect(toFormFields(DEFAULT_OPTIONS)).toEqual([
      ["CPN", "1"],
      ["COLT", "NO"],
      ["DUP", "DP"],
      ["CLR", "AUTO"],
      ["IT", "AUTO"],
      ["SIZ", "A4"],
      ["MED", "NUL"],
      ["DEL", "IMP"],
      ["PPUSR", ""],
      ["HOUR", ""],
      ["MIN", ""],
      ["SPUSR", ""],
      ["SPID", "************"],
      ["RSPID", "************"],
      ["ESPID", "off"],
    ]);
  });

  it("maps every option to firmware codes", () => {
    const f = fields({
      copies: 12,
      collate: "on",
      duplex: "short-edge",
      color: "color",
      tray: "bypass",
      paperSize: "letter",
      media: "bond",
      delivery: { type: "normal" },
      pagesPerSheet: 2,
    });
    expect(f).toMatchObject({ CPN: "12", COLT: "ON", DUP: "TB", CLR: "CLR", IT: "SMH", SIZ: "LT", MED: "HQ" });
  });

  it("never sends pages per sheet to the printer (it is applied in the browser)", () => {
    expect(toFormFields({ ...DEFAULT_OPTIONS, pagesPerSheet: 4 })).toEqual(toFormFields(DEFAULT_OPTIONS));
  });

  it("encodes secure, sample and delayed delivery", () => {
    expect(fields({ ...DEFAULT_OPTIONS, delivery: { type: "secure", userId: "alice", pin: "1234" } })).toMatchObject({
      DEL: "SECP",
      SPUSR: "alice",
      SPID: "1234",
      RSPID: "1234",
      ESPID: "on",
    });
    expect(fields({ ...DEFAULT_OPTIONS, delivery: { type: "sample", userId: "bob" } })).toMatchObject({ DEL: "PRP", PPUSR: "bob" });
    expect(fields({ ...DEFAULT_OPTIONS, delivery: { type: "delayed", hour: 18, minute: 5 } })).toMatchObject({
      DEL: "DLY",
      HOUR: "18",
      MIN: "5",
    });
  });
});

describe("validateOptions", () => {
  it("accepts the defaults", () => {
    expect(validateOptions(DEFAULT_OPTIONS)).toEqual([]);
  });

  it("rejects bad values", () => {
    expect(validateOptions({ ...DEFAULT_OPTIONS, copies: 0 })).toContain("copiesOutOfRange");
    expect(validateOptions({ ...DEFAULT_OPTIONS, copies: 1000 })).toContain("copiesOutOfRange");
    expect(validateOptions({ ...DEFAULT_OPTIONS, delivery: { type: "secure", userId: "", pin: "12a" } })).toEqual([
      "userIdRequired",
      "pinInvalid",
    ]);
    expect(validateOptions({ ...DEFAULT_OPTIONS, delivery: { type: "delayed", hour: 24, minute: 0 } })).toEqual(["timeInvalid"]);
  });
});
