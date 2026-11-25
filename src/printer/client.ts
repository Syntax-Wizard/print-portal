/**
 * PrinterClient: the only module that talks to the printer.
 *
 * It runs inside the printer's own origin (injected by the bookmarklet), so every
 * request is same-origin and needs no server in between.
 */

import { parseErrorLog, parseGeneral, parseHistory, parseQueue, parseSupplies, parseTrays, parseUploadResponse } from "./parsers";
import { toFormFields } from "./options";
import type { ErrorLogEntry, HistoryJob, PrintOptions, PrinterStatus, QueuedJob, SubmitResult } from "./types";

export type { HistoryJob };

export class PrinterUnreachableError extends Error {
  constructor(cause?: unknown) {
    super("Printer is unreachable", { cause });
    this.name = "PrinterUnreachableError";
  }
}

export interface UploadResponse {
  status: number;
  text: string;
}

/** Sends a multipart form and reports upload progress (0..1). Abstracted for tests. */
export type UploadTransport = (
  url: string,
  body: FormData,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
) => Promise<UploadResponse>;

export interface PrinterClientConfig {
  /** Base URL of the printer. Empty string means "same origin" (production). */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  transport?: UploadTransport;
  /** Timeout for status pages. Uploads have no timeout because large files take a while. */
  pageTimeoutMs?: number;
}

export interface SubmitCallbacks {
  /** Called with 0..1 while the file is uploading. */
  onProgress?: (fraction: number) => void;
  /** Called when this submission leaves the local queue and starts uploading. */
  onStart?: () => void;
  signal?: AbortSignal;
}

/** Default transport based on XMLHttpRequest, because fetch cannot report upload progress. */
export const xhrTransport: UploadTransport = (url, body, onProgress, signal) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => reject(new PrinterUnreachableError());
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });

export class PrinterClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly transport: UploadTransport;
  private readonly pageTimeoutMs: number;
  /** Uploads are serialized: the printer's embedded web server copes poorly with parallel uploads. */
  private uploadChain: Promise<unknown> = Promise.resolve();

  constructor(config: PrinterClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "").replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? ((input, init) => fetch(input, init));
    this.transport = config.transport ?? xhrTransport;
    this.pageTimeoutMs = config.pageTimeoutMs ?? 15_000;
  }

  /** Fetch a printer page as text. Throws PrinterUnreachableError on network failure or timeout. */
  async getPage(page: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.pageTimeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/${page}`, { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new PrinterUnreachableError(new Error(`HTTP ${res.status} for ${page}`));
      return await res.text();
    } catch (err) {
      if (err instanceof PrinterUnreachableError) throw err;
      throw new PrinterUnreachableError(err);
    } finally {
      clearTimeout(timer);
    }
  }

  async getStatus(): Promise<PrinterStatus> {
    const [general, trays, supplies] = await Promise.all([
      this.getPage("stgen.htm"),
      this.getPage("sttray.htm"),
      this.getPage("stsply.htm"),
    ]);
    return {
      device: parseGeneral(general),
      ...parseTrays(trays),
      supplies: parseSupplies(supplies),
      fetchedAt: new Date(),
    };
  }

  async getQueue(): Promise<QueuedJob[]> {
    return parseQueue(await this.getPage("jblist.htm"));
  }

  async getHistory(): Promise<HistoryJob[]> {
    return parseHistory(await this.getPage("jbhist.htm"));
  }

  async getErrorLog(): Promise<ErrorLogEntry[]> {
    return parseErrorLog(await this.getPage("sperr.htm"));
  }

  /**
   * Submit one file. Calls are queued and executed one at a time.
   * Never throws for printer-side problems; they are reported as `{ ok: false, code }`.
   */
  submit(file: Blob & { name?: string }, options: PrintOptions, callbacks: SubmitCallbacks = {}): Promise<SubmitResult> {
    const run = async (): Promise<SubmitResult> => {
      if (callbacks.signal?.aborted) return { ok: false, code: "ABORTED" };
      callbacks.onStart?.();
      const body = new FormData();
      for (const [name, value] of toFormFields(options)) body.append(name, value);
      body.append("FILE", file, file.name ?? "document");
      try {
        const res = await this.transport(`${this.baseUrl}/UPLPRT.cmd`, body, (f) => callbacks.onProgress?.(f), callbacks.signal);
        return parseUploadResponse(res.status, res.text);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return { ok: false, code: "ABORTED" };
        return { ok: false, code: "PRINTER_UNREACHABLE" };
      }
    };
    const result = this.uploadChain.then(run, run);
    this.uploadChain = result.catch(() => undefined);
    return result;
  }
}

/**
 * After a successful upload, find the job it produced: the first queue entry whose id
 * was not present before the upload started. Because uploads are serialized, this is
 * unambiguous for jobs submitted from this tab.
 */
export function findNewJob(before: ReadonlySet<string>, queue: readonly QueuedJob[], owner?: string | null): QueuedJob | undefined {
  return queue.find((job) => !before.has(job.id) && job.type === "print" && (!owner || job.owner === owner));
}

/** History timestamps only have minute precision, so allow some slack before the upload time. */
const HISTORY_SLACK_MS = 90_000;

function historySignature(h: HistoryJob): string {
  return `${h.owner}|${h.completedAt?.getTime() ?? ""}|${h.pages ?? ""}`;
}

/**
 * Fallback for jobs that finished before we ever saw them in the queue: find a browser-submitted
 * job in the history that completed after `since`. `claimed` counts history entries already
 * matched to earlier uploads (entries can be identical, so counts rather than a set) and is updated.
 */
export function findFinishedJob(history: readonly HistoryJob[], since: Date, owner: string | null, claimed: Map<string, number>): HistoryJob | undefined {
  const seen = new Map<string, number>();
  // History is newest first; walk oldest first so earlier uploads match earlier entries.
  for (const h of [...history].reverse()) {
    if (h.hostInterface !== "HTTP" || h.type !== "print" || !h.completedAt) continue;
    if (h.completedAt.getTime() < since.getTime() - HISTORY_SLACK_MS) continue;
    if (owner && h.owner !== owner) continue;
    const sig = historySignature(h);
    const n = (seen.get(sig) ?? 0) + 1;
    seen.set(sig, n);
    if (n > (claimed.get(sig) ?? 0)) {
      claimed.set(sig, n);
      return h;
    }
  }
  return undefined;
}
