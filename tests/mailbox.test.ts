import { describe, expect, it } from "vitest";
import { fixture } from "./fixtures";
import {
  MailboxClient,
  chunk,
  isRetrievable,
  parseDeleteResponse,
  parseMailboxList,
  parseOpenResponse,
  parseRequestError,
  parseRetrieveLinks,
} from "../src/printer/mailbox";
import { parseGeneral } from "../src/printer/parsers";

describe("mailbox parsers (pages captured from the real printer)", () => {
  it("lists boxes", () => {
    const boxes = parseMailboxList(fixture("scpblst.htm"));
    expect(boxes).toHaveLength(28);
    expect(boxes.find((b) => b.number === 27)).toEqual({ number: 27, name: "test", documentCount: null });
  });

  it("recognises the password prompt", () => {
    expect(parseOpenResponse(fixture("box-password.html"))).toEqual({ ok: true, kind: "passwordRequired" });
  });

  it("reads the document list and session token", () => {
    const result = parseOpenResponse(fixture("box-documents.html"));
    expect(result).toMatchObject({ ok: true, kind: "documents", session: { box: 27, name: "test", token: "*FAKETOKEN0000000000000=" } });
    if (!result.ok || result.kind !== "documents") throw new Error("unexpected");
    expect(result.documents).toEqual([
      { id: 967, name: "20261125155253", storedAt: new Date("2026-11-25T06:52:00Z"), pages: 2, type: "scan" },
      { id: 966, name: "20261125155139", storedAt: new Date("2026-11-25T06:51:00Z"), pages: 1, type: "scan" },
    ]);
  });

  it("tells a wrong password from a busy printer", () => {
    expect(parseOpenResponse(fixture("box-wrong-password.html"))).toEqual({ ok: false, code: "WRONG_PASSWORD" });
    expect(parseRequestError(fixture("box-busy.html"))).toBe("PRINTER_BUSY");
  });

  it("reads one download link per document (spread over several lines)", () => {
    expect(parseRetrieveLinks(fixture("box-retrieve.html"))).toEqual({
      ok: true,
      value: [
        { documentId: 967, fileName: "20261125155253.pdf", path: "/box/FAKELINKabcdefghijklmnopqrstu/20261125155253.pdf" },
        { documentId: 966, fileName: "20261125155139.pdf", path: "/box/FAKELINKabcdefghijklmnopqrstu/20261125155139.pdf" },
      ],
    });
  });

  it("reads delete results", () => {
    expect(parseDeleteResponse(fixture("box-delete-accepted.html"))).toEqual({ ok: true, value: null });
    expect(parseDeleteResponse(fixture("box-busy.html"))).toEqual({ ok: false, code: "PRINTER_BUSY" });
  });
});

describe("device states seen during the mailbox investigation", () => {
  it("maps 'available' and 'panel in use' even without a severity flag", () => {
    expect(parseGeneral("var spcs=['M',[],'','','使用できます(一部節電中)'];")).toMatchObject({ state: "ready", severity: "ok" });
    expect(parseGeneral("var spcs=['M',[],'','','パネル操作中です(一部節電中)','i'];")).toMatchObject({ state: "panelInUse" });
    expect(parseGeneral("var spcs=['M',[],'','','節電中','i'];")).toMatchObject({ state: "sleep" });
  });
});

describe("MailboxClient", () => {
  const session = { box: 27, name: "test", token: "*TOKEN=" };

  function recorder(responses: Record<string, string>) {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") });
      const key = Object.keys(responses).find((k) => url.includes(k));
      return new Response(key ? responses[key] : "Not found", { status: key ? 200 : 404 });
    };
    return { calls, client: new MailboxClient({ fetchImpl }) };
  }

  it("posts the password like the printer's own form", async () => {
    const { calls, client } = recorder({ "PBPWD.cmd": fixture("box-documents.html") });
    const result = await client.unlock(27, "secret");
    expect(result).toMatchObject({ ok: true, kind: "documents" });
    expect(calls[0]).toMatchObject({ url: "/PBPWD.cmd", method: "POST" });
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.body))).toEqual({ PWD: "secret", SET: "1", BOX: "27", ORD: "DD" });
  });

  it("requests links with the token and documents joined by '/'", async () => {
    const { calls, client } = recorder({ "PBDOCLNK.cmd": fixture("box-retrieve.html") });
    const result = await client.retrieve(session, [967, 966]);
    expect(result.ok && result.value).toHaveLength(2);
    const params = new URL(calls[0]!.url, "http://x").searchParams;
    expect(params.get("PWD")).toBe("*TOKEN=");
    expect(params.get("DOC")).toBe("967/966/");
    expect(params.get("FORM")).toBe("PDF");
  });

  it("retrieves a single page for thumbnails, and downloads it", async () => {
    const { calls, client } = recorder({ "PBDOCLNK.cmd": fixture("box-retrieve.html"), "/box/": "%PDF-1.3 page" });
    const result = await client.fetchDocument(session, 967, { page: 1 });
    expect(result.ok).toBe(true);
    expect(new URL(calls[0]!.url, "http://x").searchParams.get("PAGE")).toBe("1");
    expect(calls[1]!.url).toBe("/box/FAKELINKabcdefghijklmnopqrstu/20261125155253.pdf");
    await expect(client.retrieve(session, [1, 2], "pdf", 1)).rejects.toThrow();
  });

  it("knows which documents the printer can retrieve", () => {
    const doc = { id: 1, name: "x", storedAt: null, pages: 1 };
    expect(isRetrievable({ ...doc, type: "scan" })).toBe(true);
    expect(isRetrievable({ ...doc, type: "print" })).toBe(false);
  });

  it("splits large selections into requests of at most 9 documents", async () => {
    const { calls, client } = recorder({ "PBDOCRM.cmd": fixture("box-delete-accepted.html") });
    const ids = Array.from({ length: 12 }, (_, i) => i + 1);
    expect(await client.remove(session, ids)).toEqual({ ok: true, value: null });
    expect(calls.map((c) => new URLSearchParams(c.body).get("DOC"))).toEqual(["1/2/3/4/5/6/7/8/9/", "10/11/12/"]);
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });

  it("stops at the first failed delete and reports why", async () => {
    const { client } = recorder({ "PBDOCRM.cmd": fixture("box-busy.html") });
    expect(await client.remove(session, [1])).toEqual({ ok: false, code: "PRINTER_BUSY" });
  });

  it("reports an unreachable printer", async () => {
    const client = new MailboxClient({ fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
    expect(await client.unlock(27, "x")).toEqual({ ok: false, code: "PRINTER_UNREACHABLE" });
    expect(await client.list()).toEqual({ ok: false, code: "PRINTER_UNREACHABLE" });
  });
});
