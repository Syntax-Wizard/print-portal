/**
 * Mock ApeosPort printer for development and end-to-end tests.
 *
 * Serves sanitized pages captured from the real device and emulates /UPLPRT.cmd,
 * including a job that moves waiting -> printing -> completed -> history.
 * Nothing is ever printed.
 *
 * Usage:  npm run mock                     (port 8631)
 *         MOCK_SCENARIO=paperOut npm run mock
 *         Scenarios: default | lowToner | paperOut | jam | slow
 *
 * The built bundle (dist/) is served under /__portal/ so the real bookmarklet can be tested.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extname, join, normalize } from "node:path";

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
};

function send(res: ServerResponse, status: number, body: string | Buffer, type = "text/html"): void {
  // Same headers as the real printer: no CSP, no CORS, frames limited to same origin.
  res.writeHead(status, { "Content-Type": type, "X-Frame-Options": "SAMEORIGIN", "Cache-Control": "no-cache", Pragma: "no-cache" });
  res.end(body);
}

/** Rough page count for PDFs (counts page objects); 1 for anything else. */
async function estimatePages(file: File): Promise<number> {
  if (!file.name.toLowerCase().endsWith(".pdf")) return 1;
  const text = new TextDecoder("latin1").decode(await file.arrayBuffer());
  return Math.max(1, text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 1);
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
  console.log(`[mock] accepted "${file.name}" (${file.size} bytes) as job ${job.id}`, fields);
  send(res, 200, fixture("upload-accepted.html"));
}

function serveDist(path: string, res: ServerResponse): void {
  const rel = normalize(path.replace(/^\/__portal\//, "")).replace(/^(\.\.[/\\])+/, "");
  const file = join(DIST, rel || "index.html");
  if (!file.startsWith(DIST) || !existsSync(file)) return send(res, 404, "Not found (run `npm run build` first)", "text/plain");
  send(res, 200, readFileSync(file), CONTENT_TYPES[extname(file)] ?? "application/octet-stream");
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
  if (path.startsWith("/__portal/")) return serveDist(path, res);
  const page = path === "/" ? "print.htm" : path.slice(1);
  const html = /^[A-Za-z0-9_]+\.htm$/.test(page) ? renderPage(page) : undefined;
  if (html === undefined) return send(res, 404, "<HTML><BODY>Not found</BODY></HTML>");
  send(res, 200, html);
});

server.listen(PORT, () => {
  console.log(`[mock] printer listening on http://localhost:${PORT}/ (scenario: ${SCENARIO})`);
});
