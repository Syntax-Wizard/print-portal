/**
 * Mock ApeosPort printer for development and end-to-end tests.
 *
 * Serves sanitized pages captured from the real device and emulates /UPLPRT.cmd,
 * including a job that moves waiting -> printing -> completed -> history.
 * Nothing is ever printed.
 *
 * Usage:  npm run mock                     (port 8631)
 *         MOCK_SCENARIO=paperOut npm run mock
 *         Scenarios: default | lowToner | paperOut | jam | slow | boxBusy
 *
 * Mailboxes: every box opens with the password "1234"; box 27 starts with two documents.
 * POST /__mock/scan?box=27 adds a document, as if someone had just scanned into the box.
 *
 * The built bundle (dist/) is served under /__portal/ so the real bookmarklet can be tested.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extname, join, normalize } from "node:path";
import { PDFDocument } from "pdf-lib";

const PORT = Number(process.env.MOCK_PORT ?? 8631);
const SCENARIO = process.env.MOCK_SCENARIO ?? "default";
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));

/** Job timing in milliseconds (scaled down for tests via MOCK_SPEED). */
const SPEED = Number(process.env.MOCK_SPEED ?? 1);
const T_PRINTING = 2500 / SPEED;
const T_DONE = 5000 / SPEED;
const T_GONE = 6500 / SPEED;

interface MockJob {
  id: string;
  owner: string;
  state: number; // 0 waiting, 1 printing, 4 completed
  submittedAt: number;
  pages: number;
}

const queue: MockJob[] = [];
const history: string[] = []; // jHst rows as JS literal strings, newest first
let nextJobId = 0x1c600;

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

function jsString(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function tokyoTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

/** Advance job states based on elapsed time. */
function tick(): void {
  const now = Date.now();
  for (let i = queue.length - 1; i >= 0; i--) {
    const job = queue[i]!;
    const age = now - job.submittedAt;
    if (age >= T_GONE) {
      queue.splice(i, 1);
      history.unshift(
        `['**********',${jsString(job.owner)},1,1,${job.pages},'センタートレイ','HTTP',${jsString(tokyoTimestamp(new Date()))}]`,
      );
    } else if (age >= T_DONE) job.state = 4;
    else if (age >= T_PRINTING) job.state = 1;
  }
}

/** Apply scenario tweaks to a status page. */
function applyScenario(name: string, html: string): string {
  if (SCENARIO === "lowToner" && name === "stsply.htm") {
    return html.replace("['イエロートナー(Y)',7,25,", "['イエロートナー(Y)',3,0,").replace("['マゼンタトナー(M)',7,25,", "['マゼンタトナー(M)',2,10,");
  }
  if (SCENARIO === "paperOut" && name === "sttray.htm") {
    return html.replace("['トレイ1',0,100,", "['トレイ1',1,0,");
  }
  if (SCENARIO === "jam" && name === "stgen.htm") {
    return html
      .replace("'節電中','i']", "'紙づまりが発生しました','f']")
      .replace("var artinfo=[];", "var artinfo=[1,[2,'077-101','用紙がつまりました。前カバーを開けて用紙を取り除いてください。',0]];");
  }
  return html;
}

function renderPage(name: string): string | undefined {
  if (!existsSync(join(FIXTURES, name))) return undefined;
  let html = applyScenario(name, fixture(name));
  if (name === "jblist.htm") {
    tick();
    const rows = queue.map((j) => `[${jsString(j.id.padStart(8, "0"))},'**********',${jsString(j.owner)},${j.state},1,${j.state === 4 ? 1 : 0}]`);
    html = html.replace("var info=[];", `var info=[${rows.join(",")}];`);
  }
  if (name === "jbhist.htm") {
    tick();
    if (history.length) html = html.replace("var jHst=[", `var jHst=[${history.join(",")},`);
  }
  return html;
}

function clientAddress(req: IncomingMessage): string {
  const addr = req.socket.remoteAddress ?? "127.0.0.1";
  return addr.replace(/^::ffff:/, "").replace(/^::1$/, "127.0.0.1");
}

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
  ".json": "application/json",
  ".wasm": "application/wasm",
};

function send(res: ServerResponse, status: number, body: string | Buffer, type = "text/html"): void {
  // Same headers as the real printer: no CSP, no CORS, frames limited to same origin.
  res.writeHead(status, { "Content-Type": type, "X-Frame-Options": "SAMEORIGIN", "Cache-Control": "no-cache", Pragma: "no-cache" });
  res.end(body);
}

/** Page count for PDFs (1 for anything else, or when the file cannot be parsed). */
async function estimatePages(file: File): Promise<number> {
  if (!file.name.toLowerCase().endsWith(".pdf")) return 1;
  try {
    return (await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })).getPageCount();
  } catch {
    return 1;
  }
}

/** What the last upload looked like, for end-to-end tests (GET /__mock/last-upload). */
let lastUpload: { name: string; size: number; pages: number; firstPageSize: [number, number] | null; firstPageRotation: number | null; fields: Record<string, string> } | null = null;

async function firstPageRotation(file: File): Promise<number | null> {
  try {
    return (await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })).getPage(0).getRotation().angle;
  } catch {
    return null;
  }
}

async function firstPageSize(file: File): Promise<[number, number] | null> {
  try {
    const page = (await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })).getPage(0);
    return [Math.round(page.getWidth()), Math.round(page.getHeight())];
  } catch {
    return null;
  }
}

async function handleUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const request = new Request(`http://localhost${req.url}`, {
    method: "POST",
    headers: req.headers as Record<string, string>,
    body: req as unknown as ReadableStream,
    duplex: "half",
  } as RequestInit);
  const form = await request.formData();
  const file = form.get("FILE");
  const fields = Object.fromEntries([...form.entries()].filter(([k]) => k !== "FILE").map(([k, v]) => [k, String(v)]));
  await new Promise((r) => setTimeout(r, SCENARIO === "slow" ? 4000 : 300 / SPEED));

  if (!(file instanceof File) || file.size === 0) {
    console.log(`[mock] rejected upload (empty file)`);
    return send(res, 503, fixture("upload-error.html"));
  }
  const job: MockJob = { id: (nextJobId++).toString(16), owner: clientAddress(req), state: 0, submittedAt: Date.now(), pages: await estimatePages(file) };
  queue.push(job);
  lastUpload = { name: file.name, size: file.size, pages: job.pages, firstPageSize: await firstPageSize(file), firstPageRotation: await firstPageRotation(file), fields };
  console.log(`[mock] accepted "${file.name}" (${file.size} bytes) as job ${job.id}`, fields);
  send(res, 200, fixture("upload-accepted.html"));
}

function serveDist(path: string, res: ServerResponse): void {
  const rel = normalize(path.replace(/^\/__portal\//, "")).replace(/^(\.\.[/\\])+/, "");
  const file = join(DIST, rel || "index.html");
  if (!file.startsWith(DIST) || !existsSync(file)) return send(res, 404, "Not found (run `npm run build` first)", "text/plain");
  send(res, 200, readFileSync(file), CONTENT_TYPES[extname(file)] ?? "application/octet-stream");
}

// ---- Mailboxes ----

const BOX_PASSWORD = "1234";
const BOX_TOKEN = "*FAKETOKEN0000000000000=";
const LINK_DIR = "/box/FAKELINKabcdefghijklmnopqrstu/";

interface MockDocument {
  id: number;
  storedAt: Date;
  pages: number;
}

const mailboxes = new Map<number, MockDocument[]>([
  [
    27,
    [
      { id: 967, storedAt: new Date("2026-11-25T06:52:53Z"), pages: 2 },
      { id: 966, storedAt: new Date("2026-11-25T06:51:39Z"), pages: 1 },
    ],
  ],
]);
let nextDocumentId = 968;

function readBody(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(new URLSearchParams(body)));
    req.on("error", reject);
  });
}

function boxName(box: number): string {
  return box === 27 ? "test" : `Box ${box}`;
}

function documentName(d: MockDocument): string {
  return tokyoTimestamp(d.storedAt).replace(/\D/g, "") + String(d.storedAt.getUTCSeconds()).padStart(2, "0");
}

function renderDocuments(box: number): string {
  const docs = mailboxes.get(box) ?? [];
  const rows = docs.map((d) => `[${d.id},${jsString(tokyoTimestamp(d.storedAt))},3,${d.pages},2,${jsString(documentName(d))},0,0,0]`);
  return fixture("box-documents.html")
    .replace(/var box=\[[^\]]*\];/, `var box=[${box},'${BOX_TOKEN}','DD',1,${jsString(boxName(box))},0];`)
    .replace(/var lst=\[[^;]*\];/, `var lst=[${rows.join(",")}];`);
}

async function handleMailbox(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname;
  if (req.method === "POST" && path === "/PBDOCLST.cmd") {
    const box = Number((await readBody(req)).get("BOX"));
    send(res, 200, fixture("box-password.html").replace(/var Boxnum = \d+;/, `var Boxnum = ${box};`));
    return true;
  }
  if (req.method === "POST" && path === "/PBPWD.cmd") {
    const form = await readBody(req);
    const box = Number(form.get("BOX"));
    if (form.get("PWD") !== BOX_PASSWORD) send(res, 503, fixture("box-wrong-password.html"));
    else send(res, 200, renderDocuments(box));
    return true;
  }
  if (req.method === "GET" && path === "/PBDOCLNK.cmd") {
    const box = Number(url.searchParams.get("BOX"));
    if (url.searchParams.get("PWD") !== BOX_TOKEN) return send(res, 503, fixture("box-wrong-password.html")), true;
    const ids = (url.searchParams.get("DOC") ?? "").split("/").filter(Boolean).map(Number);
    const docs = (mailboxes.get(box) ?? []).filter((d) => ids.includes(d.id));
    const info = docs.map((d) => `[${box},${d.id},0,${jsString(documentName(d))},${jsString(LINK_DIR + documentName(d) + ".pdf")}]`);
    send(res, 200, fixture("box-retrieve.html").replace(/var info=\[[\s\S]*?\];/, `var info=[${info.join("\n,")}];`));
    return true;
  }
  if (req.method === "GET" && path.startsWith(LINK_DIR)) {
    const file = decodeURIComponent(path.slice(LINK_DIR.length));
    res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename*=utf-8''${encodeURIComponent(file)}` });
    res.end(readFileSync(join(FIXTURES, "box-document.pdf")));
    return true;
  }
  if (req.method === "POST" && path === "/PBDOCRM.cmd") {
    const form = await readBody(req);
    await new Promise((r) => setTimeout(r, 200 / SPEED));
    if (SCENARIO === "boxBusy") return send(res, 503, fixture("box-busy.html")), true;
    if (form.get("PWD") !== BOX_TOKEN) return send(res, 503, fixture("box-wrong-password.html")), true;
    const box = Number(form.get("BOX"));
    const ids = (form.get("DOC") ?? "").split("/").filter(Boolean).map(Number);
    mailboxes.set(box, (mailboxes.get(box) ?? []).filter((d) => !ids.includes(d.id)));
    console.log(`[mock] deleted documents ${ids.join(", ")} from box ${box}`);
    send(res, 200, fixture("box-delete-accepted.html"));
    return true;
  }
  if (req.method === "POST" && path === "/__mock/scan") {
    const box = Number(url.searchParams.get("box") ?? 27);
    const doc = { id: nextDocumentId++, storedAt: new Date(), pages: 1 };
    mailboxes.set(box, [doc, ...(mailboxes.get(box) ?? [])]);
    send(res, 200, JSON.stringify(doc), "application/json");
    return true;
  }
  return false;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  if (req.method === "POST" && path === "/UPLPRT.cmd") {
    handleUpload(req, res).catch((err) => {
      console.error("[mock] upload failed", err);
      send(res, 500, "Internal error", "text/plain");
    });
    return;
  }
  if (path === "/__portal/toner.json") {
    // Same CORS behaviour as raw.githubusercontent.com, which serves the real snapshot.
    const snapshot = JSON.parse(fixture("toner.json"));
    snapshot.measuredAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(snapshot));
    return;
  }
  if (path === "/__mock/last-upload") return send(res, 200, JSON.stringify(lastUpload), "application/json");
  if (path.startsWith("/__portal/")) return serveDist(path, res);
  if (/^\/(PBDOCLST|PBPWD|PBDOCLNK|PBDOCRM)\.cmd$/.test(path) || path.startsWith("/box/") || path === "/__mock/scan") {
    handleMailbox(req, res, url)
      .then((handled) => handled || send(res, 404, "Not found", "text/plain"))
      .catch((err) => {
        console.error("[mock] mailbox request failed", err);
        send(res, 500, "Internal error", "text/plain");
      });
    return;
  }
  const page = path === "/" ? "print.htm" : path.slice(1);
  const html = /^[A-Za-z0-9_]+\.htm$/.test(page) ? renderPage(page) : undefined;
  if (html === undefined) return send(res, 404, "<HTML><BODY>Not found</BODY></HTML>");
  send(res, 200, html);
});

server.listen(PORT, () => {
  console.log(`[mock] printer listening on http://localhost:${PORT}/ (scenario: ${SCENARIO})`);
});
