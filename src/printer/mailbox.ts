/**
 * Mailboxes ("ボックス"): scanned documents stored on the printer behind a per-box password.
 * See docs/DESIGN.md §15 for the protocol, which was verified on the real device.
 *
 * Security: the token returned after a correct password is always the same for a given
 * password, so it is as secret as the password itself. Neither is ever persisted here.
 */

import { extractBodyText, extractTitle, extractVar } from "./html";
import type { JsValue } from "./jsLiteral";
import { numberOrNull, parsePrinterDate } from "./mappings";

export interface MailboxSummary {
  number: number;
  name: string;
  /** Hidden by the printer for password-protected boxes. */
  documentCount: number | null;
}

export type MailboxDocumentType = "unknown" | "print" | "scan" | "fax" | "mail" | "incomplete";

export interface MailboxDocument {
  id: number;
  /** File name the printer gives the document (usually a timestamp such as 20261125155253). */
  name: string;
  storedAt: Date | null;
  pages: number | null;
  type: MailboxDocumentType;
}

export interface MailboxSession {
  box: number;
  name: string;
  /** Opaque token from the printer, equivalent to the password. Keep in memory only. */
  token: string;
}

export interface RetrieveLink {
  documentId: number;
  fileName: string;
  /** Same-origin path such as /box/<random>/<name>.pdf */
  path: string;
}

export type MailboxErrorCode = "WRONG_PASSWORD" | "PRINTER_BUSY" | "PRINTER_UNREACHABLE" | "UNEXPECTED_RESPONSE";

export type MailboxResult<T> = { ok: true; value: T } | { ok: false; code: MailboxErrorCode };

export type OpenResult =
  | { ok: true; kind: "documents"; session: MailboxSession; documents: MailboxDocument[] }
  | { ok: true; kind: "passwordRequired" }
  | { ok: false; code: MailboxErrorCode };

export type RetrieveFormat = "pdf" | "tiffJpeg";

/** The printer only retrieves scanned, faxed and e-mailed documents (not stored print jobs). */
export function isRetrievable(doc: MailboxDocument): boolean {
  return doc.type === "scan" || doc.type === "fax" || doc.type === "mail";
}

/** The printer accepts at most this many documents per retrieve or delete request. */
export const MAX_DOCUMENTS_PER_REQUEST = 9;

/** scpblst.htm `job` labels, by index. */
const DOCUMENT_TYPES: readonly MailboxDocumentType[] = ["unknown", "print", "scan", "fax", "mail", "incomplete"];

type Row = JsValue[];

function rows(value: JsValue | undefined): Row[] {
  return Array.isArray(value) ? value.filter((r): r is Row => Array.isArray(r)) : [];
}

const str = (v: JsValue | undefined) => (typeof v === "string" ? v : v == null ? "" : String(v));

// ---- Parsers ----

/** scpblst.htm: `var box = [[number, name, documentCount, ?, ?], ...]` */
export function parseMailboxList(html: string): MailboxSummary[] {
  return rows(extractVar(html, "box"))
    .map((r) => ({ number: numberOrNull(r[0]) ?? -1, name: str(r[1]), documentCount: numberOrNull(r[2]) }))
    .filter((b) => b.number > 0);
}

/** Classify an error page ("REQUEST: ERROR") by what the printer says went wrong. */
export function parseRequestError(html: string): MailboxErrorCode {
  const text = extractBodyText(html).join("\n");
  if (/設定モード|setting mode|settings mode|in use/i.test(text)) return "PRINTER_BUSY";
  if (/パスワード|password|passcode/i.test(text)) return "WRONG_PASSWORD";
  return "UNEXPECTED_RESPONSE";
}

function isErrorPage(html: string): boolean {
  return /ERROR/i.test(extractTitle(html) ?? "");
}

/**
 * Response of PBDOCLST.cmd / PBPWD.cmd: either the document list, a password prompt,
 * or an error page.
 */
export function parseOpenResponse(html: string): OpenResult {
  if (isErrorPage(html)) return { ok: false, code: parseRequestError(html) };
  const box = extractVar(html, "box");
  const lst = extractVar(html, "lst");
  // Document list: var box = [number, token, order, ?, name, ?]; var lst = [[...], ...]
  if (Array.isArray(box) && typeof box[1] === "string" && Array.isArray(lst)) {
    const session: MailboxSession = { box: numberOrNull(box[0]) ?? 0, token: box[1], name: str(box[4]) };
    return { ok: true, kind: "documents", session, documents: parseDocuments(lst) };
  }
  // Password prompt: defines Boxnum and posts to PBPWD.cmd
  if (extractVar(html, "Boxnum") !== undefined || /PBPWD\.cmd/.test(html)) return { ok: true, kind: "passwordRequired" };
  return { ok: false, code: "UNEXPECTED_RESPONSE" };
}

/** lst rows: [id, storedAt, compressionIndex, pages, typeIndex, fileName, ...] */
function parseDocuments(lst: JsValue): MailboxDocument[] {
  return rows(lst)
    .map((r) => ({
      id: numberOrNull(r[0]) ?? -1,
      storedAt: parsePrinterDate(r[1]),
      pages: numberOrNull(r[3]),
      type: (typeof r[4] === "number" ? DOCUMENT_TYPES[r[4]] : undefined) ?? "unknown",
      name: str(r[5]),
    }))
    .filter((d) => d.id >= 0);
}

/** PBDOCLNK.cmd: `var info=[[box, documentId, page, fileName, '/box/<random>/<file>'], ...]` */
export function parseRetrieveLinks(html: string): MailboxResult<RetrieveLink[]> {
  if (isErrorPage(html)) return { ok: false, code: parseRequestError(html) };
  const links = rows(extractVar(html, "info"))
    .map((r) => {
      const path = str(r[4]);
      return { documentId: numberOrNull(r[1]) ?? -1, fileName: path.split("/").pop() ?? str(r[3]), path };
    })
    .filter((l) => l.documentId >= 0 && l.path.startsWith("/box/"));
  return links.length ? { ok: true, value: links } : { ok: false, code: "UNEXPECTED_RESPONSE" };
}

/** PBDOCRM.cmd: "REQUEST: ACCEPTED" or an error page. */
export function parseDeleteResponse(html: string): MailboxResult<null> {
  if (/ACCEPTED/i.test(extractTitle(html) ?? "")) return { ok: true, value: null };
  return { ok: false, code: isErrorPage(html) ? parseRequestError(html) : "UNEXPECTED_RESPONSE" };
}

// ---- Client ----

export interface MailboxClientConfig {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Split ids into groups the printer accepts in one request. */
export function chunk<T>(items: readonly T[], size = MAX_DOCUMENTS_PER_REQUEST): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const docParam = (ids: readonly number[]) => ids.map((id) => `${id}/`).join("");

export class MailboxClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: MailboxClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "").replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  private async request(path: string, init: RequestInit = {}): Promise<{ status: number; text: string } | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/${path}`, { cache: "no-store", ...init, signal: controller.signal });
      return { status: res.status, text: await res.text() };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private post(path: string, fields: Record<string, string>) {
    return this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });
  }

  async list(): Promise<MailboxResult<MailboxSummary[]>> {
    const res = await this.request("scpblst.htm");
    if (!res || res.status !== 200) return { ok: false, code: "PRINTER_UNREACHABLE" };
    return { ok: true, value: parseMailboxList(res.text) };
  }

  /** Open a box without a password; reports whether one is required. */
  async open(box: number): Promise<OpenResult> {
    const res = await this.post("PBDOCLST.cmd", { BOX: String(box), ORD: "DD", SET: "1", LTOP: "1", LNUM: "100", PAGE: "1" });
    return res ? parseOpenResponse(res.text) : { ok: false, code: "PRINTER_UNREACHABLE" };
  }

  /** Open a password-protected box. Also used to refresh the document list. */
  async unlock(box: number, password: string): Promise<OpenResult> {
    const res = await this.post("PBPWD.cmd", { PWD: password, SET: "1", BOX: String(box), ORD: "DD" });
    return res ? parseOpenResponse(res.text) : { ok: false, code: "PRINTER_UNREACHABLE" };
  }

  /**
   * Ask the printer to prepare download links (one per document). `page` retrieves a single
   * page and only works for one document; it is used for thumbnails (about half the size).
   */
  async retrieve(session: MailboxSession, ids: readonly number[], format: RetrieveFormat = "pdf", page?: number): Promise<MailboxResult<RetrieveLink[]>> {
    if (page !== undefined && ids.length !== 1) throw new Error("A single page can only be retrieved from one document");
    const links: RetrieveLink[] = [];
    for (const group of chunk(ids)) {
      const params = new URLSearchParams({
        BOX: String(session.box),
        PWD: session.token,
        ORD: "DD",
        DGACNT: "",
        GACNT: "",
        ACNTUID: "",
        DOC: docParam(group),
        FORM: format === "pdf" ? "PDF" : "TIFJPG",
        PAGE: page !== undefined ? String(page) : "",
        SMNL: "0",
        HCMP: "0",
        ICMP: "0",
        NCOLOR: "false",
      });
      const res = await this.request(`PBDOCLNK.cmd?${params}`);
      if (!res) return { ok: false, code: "PRINTER_UNREACHABLE" };
      const parsed = parseRetrieveLinks(res.text);
      if (!parsed.ok) return parsed;
      links.push(...parsed.value);
    }
    return { ok: true, value: links };
  }

  /** Download a prepared link as a Blob. */
  async download(link: RetrieveLink): Promise<MailboxResult<Blob>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs * 4);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${link.path}`, { cache: "no-store", signal: controller.signal });
      if (!res.ok) return { ok: false, code: "UNEXPECTED_RESPONSE" };
      return { ok: true, value: await res.blob() };
    } catch {
      return { ok: false, code: "PRINTER_UNREACHABLE" };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Retrieve one document (or one page of it) and download it. */
  async fetchDocument(session: MailboxSession, id: number, options: { format?: RetrieveFormat; page?: number } = {}): Promise<MailboxResult<{ blob: Blob; fileName: string }>> {
    const links = await this.retrieve(session, [id], options.format ?? "pdf", options.page);
    if (!links.ok) return links;
    const link = links.value[0]!;
    const file = await this.download(link);
    return file.ok ? { ok: true, value: { blob: file.value, fileName: link.fileName } } : file;
  }

  /** Delete documents. Fails with PRINTER_BUSY while the printer is in use. */
  async remove(session: MailboxSession, ids: readonly number[]): Promise<MailboxResult<null>> {
    for (const group of chunk(ids)) {
      const res = await this.post("PBDOCRM.cmd", { BOX: String(session.box), PWD: session.token, ORD: "DD", DOC: docParam(group) });
      if (!res) return { ok: false, code: "PRINTER_UNREACHABLE" };
      const parsed = parseDeleteResponse(res.text);
      if (!parsed.ok) return parsed;
    }
    return { ok: true, value: null };
  }
}
