/**
 * The list of files the user wants to print and the lifecycle of each one:
 * ready -> queued -> uploading -> sent -> waiting/printing -> done (or failed).
 */

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { findFinishedJob, findNewJob } from "../printer/client";
import type { PrintOptions, QueuedJob, SubmitResult } from "../printer/types";
import { isUnmapped } from "../printer/types";
import { type FileProblem, MAX_FILES, checkFile } from "./files";
import { type PdfIssue, buildPrintFile, countPdfPages, isPdf, issueFromError, needsProcessing } from "./pdfJobs";
import { usePrinter } from "./PrinterContext";

export type ItemStatus = "ready" | "queued" | "preparing" | "uploading" | "sent" | "waiting" | "printing" | "held" | "done" | "failed";

export interface PrintItem {
  key: string;
  file: File;
  problem: FileProblem | null;
  status: ItemStatus;
  progress: number;
  error?: Extract<SubmitResult, { ok: false }>;
  jobId?: string;
  /** PDFs only: page count once read, the user's page selection, and any processing problem. */
  pageCount: number | null;
  pageRange: string;
  pdfIssue?: PdfIssue;
}

const FIRST_TRACK_DELAY_MS = 800;
const TRACK_INTERVAL_MS = 2_000;
/** Give up looking for the job in the queue after this long (it may already have finished). */
const FIND_TIMEOUT_MS = 30_000;
/** Stop following a job after this long (very large or held jobs). */
const TRACK_TIMEOUT_MS = 10 * 60_000;

let keySeq = 0;

function statusForJob(job: QueuedJob): ItemStatus {
  if (isUnmapped(job.state)) return "printing";
  switch (job.state) {
    case "waiting":
      return "waiting";
    case "printing":
      return "printing";
    case "paused":
    case "held":
      return "held";
    case "completed":
      return "done";
  }
}

export function useSubmissions() {
  const { client, owner, rememberOwner, queue } = usePrinter();
  const [items, setItems] = useState<PrintItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [tooMany, setTooMany] = useState(false);
  const counting = useRef(new Set<string>());
  const ownerRef = useRef(owner);
  ownerRef.current = owner;

  const update = useCallback((key: string, patch: Partial<PrintItem>) => {
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }, []);

  const addFiles = useCallback((files: Iterable<File>) => {
    setItems((list) => {
      const incoming = [...files];
      const room = Math.max(0, MAX_FILES - list.filter((i) => i.status !== "done").length);
      setTooMany(incoming.length > room);
      const added = incoming.slice(0, room).map<PrintItem>((file) => {
        const problem = checkFile(file);
        return { key: `f${++keySeq}`, file, problem, status: problem ? "failed" : "ready", progress: 0, pageCount: null, pageRange: "" };
      });
      return [...list, ...added];
    });
  }, []);

  // Read page counts of new PDFs in the background (loads the PDF tools on first use).
  useEffect(() => {
    for (const item of items) {
      if (item.problem || item.pageCount !== null || item.pdfIssue || !isPdf(item.file) || counting.current.has(item.key)) continue;
      counting.current.add(item.key);
      countPdfPages(item.file)
        .then((pageCount) => update(item.key, { pageCount }))
        .catch((err) => update(item.key, { pdfIssue: issueFromError(err) }));
    }
  }, [items, update]);

  const setPageRange = useCallback((key: string, pageRange: string) => update(key, { pageRange }), [update]);

  const remove = useCallback((key: string) => setItems((list) => list.filter((i) => i.key !== key)), []);
  const clearDone = useCallback(() => setItems((list) => list.filter((i) => i.status !== "done")), []);

  /** History entries already matched to an upload from this tab (see findFinishedJob). */
  const claimedHistory = useRef(new Map<string, number>());

  /** Follow one job in the printer queue until it finishes. Runs in the background. */
  const track = useCallback(
    async (key: string, before: Set<string>, since: Date) => {
      const started = Date.now();
      let jobId: string | undefined;
      for (let attempt = 0; ; attempt++) {
        // Poll quickly at first: small jobs can pass through the queue in a few seconds.
        await new Promise((r) => setTimeout(r, attempt === 0 ? FIRST_TRACK_DELAY_MS : TRACK_INTERVAL_MS));
        let list: QueuedJob[];
        try {
          list = await client.getQueue();
        } catch {
          continue; // Transient network hiccup: keep trying until the timeout.
        }
        // Share what we just read so the queue panel updates without a second request.
        queue.push(list);
        const job = jobId ? list.find((j) => j.id === jobId) : findNewJob(before, list, ownerRef.current);
        if (!jobId && job) {
          jobId = job.id;
          if (!ownerRef.current) rememberOwner(job.owner);
          update(key, { jobId });
        }
        if (jobId && !job) {
          update(key, { status: "done" });
          break;
        }
        if (job) {
          const status = statusForJob(job);
          update(key, { status });
          if (status === "done") break;
        }
        if (!jobId) {
          // Never seen in the queue: it may already have finished. Look in the history.
          try {
            const finished = findFinishedJob(await client.getHistory(), since, ownerRef.current, claimedHistory.current);
            if (finished) {
              update(key, { status: finished.result === "completed" || finished.result === "warning" ? "done" : "failed" });
              break;
            }
          } catch {
            // Ignore and retry on the next round.
          }
        }
        const elapsed = Date.now() - started;
        if ((!jobId && elapsed > FIND_TIMEOUT_MS) || elapsed > TRACK_TIMEOUT_MS) break;
      }
      void queue.refresh();
    },
    [client, rememberOwner, update, queue],
  );

  const print = useCallback(
    async (options: PrintOptions, onlyKey?: string) => {
      const targets = items.filter((i) => !i.problem && (onlyKey ? i.key === onlyKey : i.status === "ready"));
      if (targets.length === 0) return;
      setBusy(true);
      for (const t of targets) update(t.key, { status: "queued", progress: 0, error: undefined });
      try {
        for (const t of targets) {
          update(t.key, { status: "uploading" });
          const since = new Date();
          let before = new Set<string>();
          try {
            const current = await client.getQueue();
            queue.push(current);
            before = new Set(current.map((j) => j.id));
          } catch {
            // Without a snapshot we can still upload; tracking just becomes less precise.
          }
          let upload = t.file;
          let sendOptions = options;
          if (needsProcessing(t, options)) {
            update(t.key, { status: "preparing" });
            try {
              ({ file: upload, options: sendOptions } = await buildPrintFile(t, options));
            } catch (err) {
              update(t.key, { status: "failed", pdfIssue: issueFromError(err) });
              continue;
            }
            update(t.key, { status: "uploading" });
          }
          const result = await client.submit(upload, sendOptions, { onProgress: (p) => update(t.key, { progress: p }) });
          if (result.ok) {
            update(t.key, { status: "sent", progress: 1 });
            void track(t.key, before, since);
          } else {
            update(t.key, { status: "failed", error: result });
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [items, client, update, track],
  );

  return { items, busy, tooMany, addFiles, remove, clearDone, print, setPageRange };
}
