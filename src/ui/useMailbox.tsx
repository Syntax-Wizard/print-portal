/**
 * State for the mailbox page: choose a box, unlock it, keep the document list fresh,
 * save and delete documents.
 *
 * The password and the printer's token live only in memory (refs/state of this hook).
 * They are dropped when the page is reloaded or closed, when another box is chosen, after
 * IDLE_TIMEOUT_MS without user activity, and when auto-receive reaches RECEIVE_MAX_MS.
 *
 * The state lives above the pages (MailboxProvider) so auto-receive keeps running while the
 * user is on the print page, and so documents can be sent to the print list.
 */

import { createContext, type ComponentChildren } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { createZip, uniqueNames } from "../util/zip";
import { BRAND_NAME } from "../brand/mark";
import {
  MailboxClient,
  type MailboxDocument,
  type MailboxErrorCode,
  type MailboxSession,
  type MailboxSummary,
  type OpenResult,
  type RetrieveFormat,
} from "../printer/mailbox";
import { loadMyMailbox, saveMyMailbox } from "./settings";
import { downloadName, loadLabels, pruneLabels, saveLabel } from "./mailboxLabels";
import { isRetrievable } from "../printer/mailbox";
import { loadPdfView } from "../pdfview/loader";

/** Thumbnail state per document: a data URL once rendered. */
export type Thumbnail = { kind: "loading" } | { kind: "ready"; url: string } | { kind: "failed" };

export interface MailboxPreview {
  doc: MailboxDocument;
  /** blob: URL of the whole document, or null while it is being retrieved. */
  url: string | null;
  failed: boolean;
}

const THUMBNAIL_WIDTH = 72;
/** Most mailboxes hold a handful of scans; cap the work in case one holds many. */
const MAX_THUMBNAILS = 40;

/**
 * Close an open box after 30 minutes without any activity (click, key, scroll) on the page.
 * Long enough to work through a few documents, short enough that a box left open on a shared
 * computer does not stay open for the rest of the day.
 */
export const IDLE_TIMEOUT_MS = 30 * 60_000;
/** Auto-receive keeps the box open without activity (you are at the printer), up to 2 hours. */
export const RECEIVE_MAX_MS = 2 * 60 * 60_000;
const REFRESH_INTERVAL_MS = 10_000;

export type MailboxPhase = "choose" | "checking" | "password" | "open";

export type MailboxNotice =
  | { kind: "error"; code: MailboxErrorCode | "listFailed" }
  | { kind: "saved"; count: number }
  | { kind: "deleted"; count: number }
  | { kind: "archived"; count: number; deleted: boolean }
  | { kind: "sentToPrint"; count: number }
  | { kind: "autoClosed" }
  | { kind: "receiveEnded" };

/** Auto-receive: new scans are downloaded as they arrive. */
export interface ReceiveState {
  until: number;
  deleteAfter: boolean;
  /** Names (or labels) of documents received so far, newest first. */
  received: string[];
  /** Documents waiting to be deleted (the printer refuses while its panel is in use). */
  pendingDeletes: number;
}

/** "027", as the printer shows box numbers. */
const boxNo = (n: number) => String(n).padStart(3, "0");

/** Save a Blob under a file name, without leaving the page. */
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function useMailbox(client?: MailboxClient) {
  // One client for the lifetime of the page, so timers and callbacks stay stable.
  const api = useMemo(() => client ?? new MailboxClient(), [client]);
  const [boxes, setBoxes] = useState<MailboxSummary[] | null>(null);
  const [myBox, setMyBoxState] = useState<number | null>(loadMyMailbox);
  const [selected, setSelected] = useState<MailboxSummary | null>(null);
  const [phase, setPhase] = useState<MailboxPhase>("choose");
  const [session, setSession] = useState<MailboxSession | null>(null);
  const [documents, setDocuments] = useState<MailboxDocument[]>([]);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [notice, setNotice] = useState<MailboxNotice | null>(null);
  const [busy, setBusy] = useState<null | "opening" | "saving" | "deleting">(null);
  const password = useRef<string | null>(null);
  const lastActivity = useRef(Date.now());
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [thumbnails, setThumbnails] = useState<Record<string, Thumbnail>>({});
  const [preview, setPreview] = useState<MailboxPreview | null>(null);
  /** Bumped on close so background thumbnail work for the old session stops. */
  const generation = useRef(0);
  const [receiving, setReceiving] = useState<ReceiveState | null>(null);
  /** Bookkeeping for auto-receive that does not need re-renders. */
  const incoming = useRef<{ baseline: Set<string>; pagesSeen: Map<string, number>; handled: Set<string>; deletes: Set<number>; busy: boolean } | null>(null);
  const [unseen, setUnseen] = useState(0);
  const activated = useRef(false);

  const close = useCallback((why?: "autoClosed" | "receiveEnded") => {
    // Boxes without a password go back to the list; others ask for the password again.
    const hadPassword = password.current !== null;
    password.current = null;
    generation.current++;
    setSession(null);
    setDocuments([]);
    setUpdatedAt(null);
    incoming.current = null;
    setReceiving(null);
    // Thumbnails stay cached in memory until the page is reloaded: re-rendering them on every
    // reopen would add another "box retrieval" to the printer's job log each time. They are only
    // shown once the box is unlocked again. Previews are full documents: drop them.
    setPreview((p) => {
      if (p?.url) URL.revokeObjectURL(p.url);
      return null;
    });
    setPhase((p) => (p === "open" ? (hadPassword ? "password" : "choose") : p));
    setNotice(why ? { kind: why } : null);
  }, []);

  const applyOpen = useCallback((result: OpenResult): boolean => {
    if (!result.ok) {
      setNotice({ kind: "error", code: result.code });
      return false;
    }
    if (result.kind === "passwordRequired") {
      password.current = null;
      setSession(null);
      setPhase("password");
      return false;
    }
    setSession(result.session);
    setDocuments(result.documents);
    setUpdatedAt(new Date());
    setPhase("open");
    return true;
  }, []);

  /** Choose a box: check whether it needs a password, and open it directly if not. */
  const choose = useCallback(
    async (box: MailboxSummary) => {
      close();
      setSelected(box);
      setNotice(null);
      setPhase("checking");
      const result = await api.open(box.number);
      if (!applyOpen(result) && !result.ok) setPhase("choose");
    },
    [api, applyOpen, close],
  );

  const unlock = useCallback(
    async (pwd: string) => {
      if (!selected) return;
      setBusy("opening");
      setNotice(null);
      const result = await api.unlock(selected.number, pwd);
      setBusy(null);
      if (applyOpen(result)) {
        password.current = pwd;
        lastActivity.current = Date.now();
      }
    },
    [api, applyOpen, selected],
  );

  /**
   * Download documents that arrived since auto-receive started. A document is taken once its
   * page count was the same on two refreshes, so a multi-page scan is not grabbed half-way.
   */
  const receiveNew = useCallback(
    async (current: MailboxSession, docs: MailboxDocument[]) => {
      const state = incoming.current;
      if (!state || state.busy) return;
      state.busy = true;
      try {
        for (const doc of docs) {
          if (!isRetrievable(doc) || state.baseline.has(doc.name) || state.handled.has(doc.name)) continue;
          if (state.pagesSeen.get(doc.name) !== doc.pages) {
            state.pagesSeen.set(doc.name, doc.pages ?? -1);
            continue;
          }
          const file = await api.fetchDocument(current, doc.id);
          if (!file.ok || incoming.current !== state) continue; // Retry on the next refresh.
          const label = loadLabels(current.box)[doc.name];
          saveBlob(file.value.blob, downloadName(label, file.value.fileName));
          state.handled.add(doc.name);
          if (receivingRef.current?.deleteAfter) state.deletes.add(doc.id);
          setReceiving((r) => (r ? { ...r, received: [label ?? doc.name, ...r.received] } : r));
          if (document.visibilityState === "hidden") setUnseen((n) => n + 1);
        }
        if (state.deletes.size > 0) {
          const ids = [...state.deletes];
          // Fails with PRINTER_BUSY while someone uses the panel (likely right after scanning):
          // keep them and try again on the next refresh.
          const result = await api.remove(current, ids);
          if (result.ok) state.deletes.clear();
        }
        setReceiving((r) => (r ? { ...r, pendingDeletes: state.deletes.size } : r));
      } finally {
        state.busy = false;
      }
    },
    [api],
  );
  const receivingRef = useRef<ReceiveState | null>(null);
  receivingRef.current = receiving;

  const startReceiving = useCallback(
    (deleteAfter: boolean) => {
      // Only documents that arrive from now on: what is already in the box stays put.
      incoming.current = { baseline: new Set(documents.map((d) => d.name)), pagesSeen: new Map(), handled: new Set(), deletes: new Set(), busy: false };
      setReceiving({ until: Date.now() + RECEIVE_MAX_MS, deleteAfter, received: [], pendingDeletes: 0 });
      setNotice(null);
    },
    [documents],
  );

  const setReceiveDelete = useCallback((deleteAfter: boolean) => setReceiving((r) => (r ? { ...r, deleteAfter } : r)), []);

  const stopReceiving = useCallback(() => {
    incoming.current = null;
    setReceiving(null);
    lastActivity.current = Date.now();
  }, []);

  const refresh = useCallback(async () => {
    if (!selected) return;
    const result = password.current !== null ? await api.unlock(selected.number, password.current) : await api.open(selected.number);
    // Background refreshes stay quiet about transient failures; the list just isn't updated.
    if (result.ok && result.kind === "documents") {
      setSession(result.session);
      setDocuments(result.documents);
      setUpdatedAt(new Date());
      if (incoming.current) void receiveNew(result.session, result.documents);
    } else if (result.ok && result.kind === "passwordRequired") {
      close();
    } else if (!result.ok && result.code === "WRONG_PASSWORD") {
      close(); // The password was changed on the printer.
    }
  }, [api, selected, close]);

  const save = useCallback(
    async (ids: number[], format: RetrieveFormat) => {
      if (!session || ids.length === 0) return;
      setBusy("saving");
      setNotice(null);
      lastActivity.current = Date.now();
      try {
        const links = await api.retrieve(session, ids, format);
        if (!links.ok) return setNotice({ kind: "error", code: links.code });
        for (const link of links.value) {
          const file = await api.download(link);
          if (!file.ok) return setNotice({ kind: "error", code: file.code });
          const doc = documents.find((d) => d.id === link.documentId);
          saveBlob(file.value, downloadName(doc ? labels[doc.name] : undefined, link.fileName));
        }
        setNotice({ kind: "saved", count: links.value.length });
        // Some boxes delete documents once retrieved; show the printer's current state.
        void refresh();
      } finally {
        setBusy(null);
      }
    },
    [api, session, refresh, documents, labels],
  );

  /** Retrieve documents as files named like downloads (label, or the printer's name). */
  const fetchFiles = useCallback(
    async (ids: number[]): Promise<Array<{ file: File; doc: MailboxDocument | undefined }> | null> => {
      if (!session) return null;
      const links = await api.retrieve(session, ids, "pdf");
      if (!links.ok) {
        setNotice({ kind: "error", code: links.code });
        return null;
      }
      const files: Array<{ file: File; doc: MailboxDocument | undefined }> = [];
      for (const link of links.value) {
        const file = await api.download(link);
        if (!file.ok) {
          setNotice({ kind: "error", code: file.code });
          return null;
        }
        const doc = documents.find((d) => d.id === link.documentId);
        files.push({ doc, file: new File([file.value], downloadName(doc ? labels[doc.name] : undefined, link.fileName), { type: "application/pdf" }) });
      }
      return files;
    },
    [api, session, documents, labels],
  );

  /** Save documents as one ZIP; optionally delete them from the box afterwards. */
  const archive = useCallback(
    async (ids: number[], deleteAfter: boolean) => {
      if (!session || !selected || ids.length === 0) return;
      setBusy("saving");
      setNotice(null);
      lastActivity.current = Date.now();
      try {
        const files = await fetchFiles(ids);
        if (!files) return;
        const names = uniqueNames(files.map((f) => f.file.name));
        // Each entry carries its scan time, so the extracted files sort and show sensibly.
        const entries = await Promise.all(
          files.map(async ({ file, doc }, i) => ({ name: names[i]!, data: new Uint8Array(await file.arrayBuffer()), modified: doc?.storedAt ?? undefined })),
        );
        const now = new Date();
        const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
        const boxName = selected.name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
        saveBlob(createZip(entries), `box${boxNo(selected.number)}-${boxName}-${day}.zip`);
        if (deleteAfter) {
          const result = await api.remove(session, ids);
          if (!result.ok) return setNotice({ kind: "error", code: result.code });
          setDocuments((docs) => docs.filter((d) => !ids.includes(d.id)));
        }
        setNotice({ kind: "archived", count: ids.length, deleted: deleteAfter });
        void refresh();
      } finally {
        setBusy(null);
      }
    },
    [api, session, selected, fetchFiles, refresh],
  );

  /** Retrieve documents and hand them to the print list. */
  const sendToPrint = useCallback(
    async (ids: number[], addFiles: (files: File[]) => void): Promise<boolean> => {
      setBusy("saving");
      setNotice(null);
      lastActivity.current = Date.now();
      try {
        const files = await fetchFiles(ids);
        if (!files) return false;
        addFiles(files.map((f) => f.file));
        setNotice({ kind: "sentToPrint", count: files.length });
        return true;
      } finally {
        setBusy(null);
      }
    },
    [fetchFiles],
  );

  const rename = useCallback(
    (doc: MailboxDocument, label: string) => {
      if (!selected) return;
      setLabels(saveLabel(selected.number, doc.name, label));
    },
    [selected],
  );

  /** Open a document in the preview dialog (retrieves the whole document). */
  const openPreview = useCallback(
    async (doc: MailboxDocument) => {
      if (!session) return;
      lastActivity.current = Date.now();
      const gen = generation.current;
      setPreview({ doc, url: null, failed: false });
      const result = await api.fetchDocument(session, doc.id);
      if (gen !== generation.current) return;
      setPreview((p) => {
        if (!p || p.doc.id !== doc.id) return p;
        return result.ok ? { doc, url: URL.createObjectURL(result.value.blob), failed: false } : { doc, url: null, failed: true };
      });
    },
    [api, session],
  );

  const closePreview = useCallback(() => {
    setPreview((p) => {
      if (p?.url) URL.revokeObjectURL(p.url);
      return null;
    });
  }, []);

  const remove = useCallback(
    async (ids: number[]): Promise<boolean> => {
      if (!session || ids.length === 0) return false;
      setBusy("deleting");
      setNotice(null);
      lastActivity.current = Date.now();
      try {
        const result = await api.remove(session, ids);
        if (!result.ok) {
          setNotice({ kind: "error", code: result.code });
          return false;
        }
        setDocuments((docs) => docs.filter((d) => !ids.includes(d.id)));
        setNotice({ kind: "deleted", count: ids.length });
        void refresh();
        return true;
      } finally {
        setBusy(null);
      }
    },
    [api, session, refresh],
  );

  const setMyBox = useCallback((box: number | null) => {
    saveMyMailbox(box);
    setMyBoxState(box);
  }, []);

  const back = useCallback(() => {
    close();
    setSelected(null);
    setNotice(null);
    setPhase("choose");
  }, [close]);

  /**
   * Load the list of boxes the first time the mailbox page is shown, then jump straight to
   * "my" box if one is set. (Not on start-up: most visits are only to print.)
   */
  const activate = useCallback(() => {
    if (activated.current) return;
    activated.current = true;
    void api.list().then((result) => {
      if (!result.ok) {
        activated.current = false; // Allow another try.
        return setNotice({ kind: "error", code: "listFailed" });
      }
      setBoxes(result.value);
      const mine = result.value.find((b) => b.number === loadMyMailbox());
      if (mine) void choose(mine);
    });
  }, [api, choose]);

  useEffect(() => {
    setLabels(selected ? loadLabels(selected.number) : {});
  }, [selected]);

  useEffect(() => {
    if (phase === "open" && selected && documents.length < 100) setLabels(pruneLabels(selected.number, documents.map((d) => d.name)));
  }, [phase, selected, documents]);

  // Thumbnails: render page 1 of each document, one at a time to go easy on the printer.
  useEffect(() => {
    if (phase !== "open" || !session) return;
    const gen = generation.current;
    const todo = documents.filter((d) => isRetrievable(d) && !thumbnails[`${session.box}:${d.name}`]).slice(0, MAX_THUMBNAILS);
    if (todo.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const doc of todo) {
        if (cancelled || gen !== generation.current) return;
        const key = `${session.box}:${doc.name}`;
        setThumbnails((t) => ({ ...t, [key]: { kind: "loading" } }));
        let thumb: Thumbnail = { kind: "failed" };
        try {
          const page = await api.fetchDocument(session, doc.id, { page: 1 });
          if (page.ok) {
            const view = await loadPdfView();
            thumb = { kind: "ready", url: await view.renderThumbnail(new Uint8Array(await page.value.blob.arrayBuffer()), THUMBNAIL_WIDTH) };
          }
        } catch {
          thumb = { kind: "failed" };
        }
        if (gen !== generation.current) return;
        setThumbnails((t) => ({ ...t, [key]: thumb }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-run when the document list changes; `thumbnails` is read, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, session?.box, documents, api]);

  // While a box is open: refresh the list regularly and close it after inactivity.
  useEffect(() => {
    if (phase !== "open") return;
    const onActivity = () => (lastActivity.current = Date.now());
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, onActivity, { passive: true });
    const timer = setInterval(() => {
      const r = receivingRef.current;
      if (r) {
        // Waiting for scans: no activity expected, and the tab is usually in the background.
        if (Date.now() > r.until) return close("receiveEnded");
        return void refresh();
      }
      if (Date.now() - lastActivity.current > IDLE_TIMEOUT_MS) return close("autoClosed");
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      for (const e of events) window.removeEventListener(e, onActivity);
    };
  }, [phase, refresh, close]);

  useEffect(() => {
    const base = BRAND_NAME;
    document.title = unseen > 0 ? `(${unseen}) ${base}` : base;
    if (unseen === 0) return;
    const onVisible = () => document.visibilityState === "visible" && setUnseen(0);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [unseen]);

  // Forget secrets when the page goes away.
  useEffect(() => () => void (password.current = null), []);

  return {
    boxes,
    myBox,
    setMyBox,
    selected,
    phase,
    session,
    documents,
    updatedAt,
    notice,
    busy,
    labels,
    thumbnails,
    preview,
    receiving,
    activate,
    startReceiving,
    stopReceiving,
    setReceiveDelete,
    archive,
    sendToPrint,
    choose,
    unlock,
    refresh,
    save,
    remove,
    rename,
    openPreview,
    closePreview,
    back,
    close,
  };
}

export type Mailbox = ReturnType<typeof useMailbox>;

const MailboxContext = createContext<Mailbox | null>(null);

export function MailboxProvider(props: { client?: MailboxClient; children: ComponentChildren }) {
  const mailbox = useMailbox(props.client);
  return <MailboxContext.Provider value={mailbox}>{props.children}</MailboxContext.Provider>;
}

export function useMailboxContext(): Mailbox {
  const value = useContext(MailboxContext);
  if (!value) throw new Error("useMailboxContext must be used inside <MailboxProvider>");
  return value;
}
