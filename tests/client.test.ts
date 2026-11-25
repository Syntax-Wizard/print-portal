import { describe, expect, it } from "vitest";
import { fixture } from "./fixtures";
import { PrinterClient, findFinishedJob, findNewJob, type UploadTransport } from "../src/printer/client";
import type { HistoryJob } from "../src/printer/types";
import { DEFAULT_OPTIONS } from "../src/printer/options";

function fakeFetch(pages: Record<string, string>): typeof fetch {
  return async (input) => {
    const page = String(input).split("/").pop()!;
    if (!(page in pages)) return new Response("Not found", { status: 404 });
    return new Response(pages[page], { status: 200 });
  };
}

describe("PrinterClient", () => {
  it("combines the three status pages", async () => {
    const client = new PrinterClient({
      fetchImpl: fakeFetch({
        "stgen.htm": fixture("stgen.htm"),
        "sttray.htm": fixture("sttray.htm"),
        "stsply.htm": fixture("stsply.htm"),
      }),
    });
    const status = await client.getStatus();
    expect(status.device.state).toBe("sleep");
    expect(status.trays).toHaveLength(5);
    expect(status.supplies.filter((s) => s.kind === "toner")).toHaveLength(4);
  });

  it("throws PrinterUnreachableError when the network fails", async () => {
    const client = new PrinterClient({
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(client.getQueue()).rejects.toMatchObject({ name: "PrinterUnreachableError" });
  });

  it("uploads the form fields in order followed by the file", async () => {
    let sent: FormData | undefined;
    const transport: UploadTransport = async (url, body, onProgress) => {
      expect(url).toBe("/UPLPRT.cmd");
      sent = body;
      onProgress(1);
      return { status: 200, text: fixture("upload-accepted.html") };
    };
    const progress: number[] = [];
    const client = new PrinterClient({ transport });
    const file = new File(["%PDF-1.4"], "report.pdf", { type: "application/pdf" });
    const result = await client.submit(file, DEFAULT_OPTIONS, { onProgress: (p) => progress.push(p) });

    expect(result).toEqual({ ok: true });
    expect(progress).toEqual([1]);
    const keys = [...sent!.keys()];
    expect(keys[0]).toBe("CPN");
    expect(keys.at(-1)).toBe("FILE");
    expect((sent!.get("FILE") as File).name).toBe("report.pdf");
    expect(sent!.get("DUP")).toBe("DP");
  });

  it("serializes concurrent uploads", async () => {
    const order: string[] = [];
    const transport: UploadTransport = async (_url, body) => {
      const name = (body.get("FILE") as File).name;
      order.push(`start:${name}`);
      await new Promise((r) => setTimeout(r, name === "a.pdf" ? 30 : 1));
      order.push(`end:${name}`);
      return { status: 200, text: fixture("upload-accepted.html") };
    };
    const client = new PrinterClient({ transport });
    await Promise.all([
      client.submit(new File(["a"], "a.pdf"), DEFAULT_OPTIONS),
      client.submit(new File(["b"], "b.pdf"), DEFAULT_OPTIONS),
    ]);
    expect(order).toEqual(["start:a.pdf", "end:a.pdf", "start:b.pdf", "end:b.pdf"]);
  });

  it("keeps the queue going after a failed upload", async () => {
    let calls = 0;
    const transport: UploadTransport = async () => {
      calls++;
      if (calls === 1) throw new TypeError("network down");
      return { status: 200, text: fixture("upload-accepted.html") };
    };
    const client = new PrinterClient({ transport });
    const [first, second] = await Promise.all([
      client.submit(new File(["a"], "a.pdf"), DEFAULT_OPTIONS),
      client.submit(new File(["b"], "b.pdf"), DEFAULT_OPTIONS),
    ]);
    expect(first).toEqual({ ok: false, code: "PRINTER_UNREACHABLE" });
    expect(second).toEqual({ ok: true });
  });

  it("does not upload when already aborted", async () => {
    const client = new PrinterClient({ transport: async () => expect.fail("should not upload") });
    const controller = new AbortController();
    controller.abort();
    expect(await client.submit(new File(["a"], "a.pdf"), DEFAULT_OPTIONS, { signal: controller.signal })).toEqual({
      ok: false,
      code: "ABORTED",
    });
  });
});

describe("findNewJob", () => {
  const job = (id: string, owner = "192.0.2.144") => ({
    id,
    name: "*",
    owner,
    state: "waiting" as const,
    type: "print" as const,
    completedCopies: 0,
  });

  it("finds the first job that was not queued before", () => {
    expect(findNewJob(new Set(["1"]), [job("1"), job("2"), job("3")])?.id).toBe("2");
  });

  it("can restrict the match to a known owner", () => {
    expect(findNewJob(new Set(), [job("1", "other"), job("2")], "192.0.2.144")?.id).toBe("2");
  });
});

describe("findFinishedJob", () => {
  const at = (iso: string): HistoryJob => ({
    name: "*",
    owner: "192.0.2.144",
    result: "completed",
    type: "print",
    pages: 1,
    outputTray: null,
    hostInterface: "HTTP",
    completedAt: new Date(iso),
  });
  const since = new Date("2026-11-25T05:03:40Z");

  it("matches a browser job finished after the upload (minute precision)", () => {
    const history = [at("2026-11-25T05:03:00Z"), at("2026-11-20T01:00:00Z")];
    expect(findFinishedJob(history, since, null, new Map())).toBe(history[0]);
  });

  it("ignores old, driver-submitted and other owners' jobs", () => {
    const history = [{ ...at("2026-11-25T05:04:00Z"), hostInterface: "LPD" }, { ...at("2026-11-25T05:04:00Z"), owner: "someone" }, at("2026-11-24T05:04:00Z")];
    expect(findFinishedJob(history, since, "192.0.2.144", new Map())).toBeUndefined();
  });

  it("matches identical entries to successive uploads only once each", () => {
    const history = [at("2026-11-25T05:04:00Z"), at("2026-11-25T05:04:00Z")];
    const claimed = new Map<string, number>();
    expect(findFinishedJob(history, since, null, claimed)).toBeDefined();
    expect(findFinishedJob(history, since, null, claimed)).toBeDefined();
    expect(findFinishedJob(history, since, null, claimed)).toBeUndefined();
  });
});
