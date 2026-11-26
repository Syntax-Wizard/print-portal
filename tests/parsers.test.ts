import { describe, expect, it } from "vitest";
import { fixture } from "./fixtures";
import {
  isPrinterPage,
  parseErrorLog,
  parseGeneral,
  parseHistory,
  parseQueue,
  parseSupplies,
  parseTrays,
  parseUploadResponse,
  supplyLevel,
} from "../src/printer/parsers";

describe("parseGeneral (stgen.htm)", () => {
  it("reads model and power-saver state", () => {
    expect(parseGeneral(fixture("stgen.htm"))).toEqual({
      model: "ApeosPort-V C4476",
      state: "sleep",
      severity: "ok",
      alerts: [],
    });
  });

  it("reads alerts and keeps unknown states raw", () => {
    const html = `var spcs=['M',[],'','','紙づまり','f'];
var artinfo=[1,[2,'071-105','Paper jam in Tray 1',0],[1,'093-423','Toner low',3]];`;
    expect(parseGeneral(html)).toEqual({
      model: "M",
      state: { raw: "紙づまり" },
      severity: "error",
      alerts: [
        { severity: "error", code: "071-105", message: "Paper jam in Tray 1", audience: "user" },
        { severity: "warning", code: "093-423", message: "Toner low", audience: "admin" },
      ],
    });
  });

  it("understands English firmware wording", () => {
    expect(parseGeneral("var spcs=['M',[],'','','Ready to print','i'];").state).toBe("ready");
    expect(parseGeneral("var spcs=['M',[],'','','Power Saver Mode','i'];").state).toBe("sleep");
  });
});

describe("parseTrays (sttray.htm)", () => {
  const { trays, outputTrays } = parseTrays(fixture("sttray.htm"));

  it("maps every input tray", () => {
    expect(trays.map((t) => t.id)).toEqual(["T1", "T2", "T3", "T4", "bypass"]);
    expect(trays[0]).toEqual({ id: "T1", state: "ok", levelPercent: 100, size: "A4", color: "white", media: "plain", priority: 1 });
    expect(trays.map((t) => t.size)).toEqual(["A4", "B5", "B4", "A3", null]);
    expect(trays.map((t) => t.levelPercent)).toEqual([100, 75, 50, 50, null]);
  });

  it("reports the bypass tray without level or priority", () => {
    expect(trays[4]).toMatchObject({ id: "bypass", levelPercent: null, size: null, priority: null, media: "plain" });
  });

  it("reads the output tray", () => {
    expect(outputTrays).toEqual([{ name: "センタートレイ", state: "ok" }]);
  });
});

describe("parseSupplies (stsply.htm)", () => {
  const supplies = parseSupplies(fixture("stsply.htm"));

  it("reads four toners with colour, level and state", () => {
    const toners = supplies.filter((s) => s.kind === "toner");
    // The web UI reports toner in 25% steps (rounded up), so 25 means "1 to 25%".
    expect(toners.map((t) => [t.color, t.level, t.state, t.severity])).toEqual([
      ["black", { min: 26, max: 50 }, "orderSpare", "warning"],
      ["cyan", { min: 26, max: 50 }, "ok", "ok"],
      ["magenta", { min: 1, max: 25 }, "orderSpare", "warning"],
      ["yellow", { min: 1, max: 25 }, "orderSpare", "warning"],
    ]);
  });

  it("reads drums and the waste toner bottle", () => {
    const drums = supplies.filter((s) => s.kind === "drum");
    // Drum values are exact (they matched SNMP on the real device).
    expect(drums.map((d) => [d.color, d.level])).toEqual([
      ["black", { min: 58, max: 58 }],
      ["cyan", { min: 28, max: 28 }],
      ["magenta", { min: 28, max: 28 }],
      ["yellow", { min: 27, max: 27 }],
    ]);
    expect(supplies.find((s) => s.kind === "wasteToner")).toMatchObject({ state: "ok", level: null, severity: "ok" });
  });

  it("turns toner steps into ranges and keeps other values exact", () => {
    expect(supplyLevel("toner", 100)).toEqual({ min: 76, max: 100 });
    expect(supplyLevel("toner", 0)).toEqual({ min: 0, max: 0 });
    expect(supplyLevel("toner", 37)).toEqual({ min: 37, max: 37 });
    expect(supplyLevel("drum", 25)).toEqual({ min: 25, max: 25 });
    expect(supplyLevel("toner", "-")).toBeNull();
    expect(supplyLevel("toner", 150)).toBeNull();
  });
});

describe("parseQueue (jblist.htm)", () => {
  it("returns an empty queue", () => {
    expect(parseQueue(fixture("jblist.htm"))).toEqual([]);
  });

  it("reads queued jobs", () => {
    const html = "var info=[['0001c562','**********','192.0.2.144',1,1,0],['0001c563','doc','u',9,1,'-']];";
    expect(parseQueue(html)).toEqual([
      { id: "0001c562", name: "**********", owner: "192.0.2.144", state: "printing", type: "print", completedCopies: 0 },
      { id: "0001c563", name: "doc", owner: "u", state: { raw: "9" }, type: "print", completedCopies: null },
    ]);
  });

  it("reports only the earliest running print job as printing; later ones are being processed", () => {
    // Listed newest first on purpose: the job ID, not the position, decides.
    const html =
      "var info=[['0001c565','**********','u',1,1,0],['0001c564','**********','u',1,4,0],['0001c563','**********','u',1,1,0],['0001c566','**********','u',0,1,0]];";
    expect(parseQueue(html).map((j) => [j.id, j.state])).toEqual([
      ["0001c565", "processing"],
      ["0001c564", "printing"], // a mailbox retrieval runs alongside printing and is left alone
      ["0001c563", "printing"],
      ["0001c566", "waiting"],
    ]);
  });

  it("keeps a single running job as printing", () => {
    const html = "var info=[['0001c563','**********','u',1,1,0],['0001c564','**********','u',0,1,0]];";
    expect(parseQueue(html).map((j) => j.state)).toEqual(["printing", "waiting"]);
  });
});

describe("parseHistory (jbhist.htm)", () => {
  const history = parseHistory(fixture("jbhist.htm"));

  it("reads all rows", () => {
    expect(history).toHaveLength(200);
  });

  it("parses the newest job including its Tokyo timestamp", () => {
    expect(history[0]).toEqual({
      name: "**********",
      owner: "user1",
      result: "completed",
      type: "print",
      pages: 1,
      outputTray: "センタートレイ",
      hostInterface: "LPD",
      completedAt: new Date("2026-11-25T05:04:00Z"),
    });
  });

  it("maps non-print jobs and missing values", () => {
    const scan = history.find((h) => h.owner === "-")!;
    expect(scan.pages).toBeNull();
    expect(scan.hostInterface).toBeNull();
  });
});

describe("parseErrorLog (sperr.htm)", () => {
  it("reads codes and times", () => {
    const log = parseErrorLog(fixture("sperr.htm"));
    expect(log).toHaveLength(50);
    expect(log[0]).toEqual({ at: new Date("2026-07-29T08:14:00Z"), code: "016-788" });
  });
});

describe("parseUploadResponse (/UPLPRT.cmd)", () => {
  it("detects an accepted job", () => {
    expect(parseUploadResponse(200, fixture("upload-accepted.html"))).toEqual({ ok: true });
  });

  it("detects a rejected file", () => {
    expect(parseUploadResponse(503, fixture("upload-error.html"))).toEqual({
      ok: false,
      code: "FILE_REJECTED",
      fields: ["ファイル"],
      httpStatus: 503,
    });
  });

  it("flags anything else as unexpected", () => {
    expect(parseUploadResponse(500, "<html><title>Oops</title></html>")).toEqual({
      ok: false,
      code: "UNEXPECTED_RESPONSE",
      httpStatus: 500,
    });
  });
});

describe("isPrinterPage", () => {
  it("recognises the printer's top page", () => {
    expect(isPrinterPage(fixture("print.htm"))).toBe(true);
    expect(isPrinterPage("<html><title>Something else</title></html>")).toBe(false);
  });
});
