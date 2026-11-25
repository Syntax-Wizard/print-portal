/**
 * State for the mailbox page: choose a box, unlock it, keep the document list fresh,
 * save and delete documents.
 *
 * The password and the printer's token live only in memory (refs/state of this hook).
 * They are dropped when the page unmounts, when another box is chosen, and after
 * IDLE_TIMEOUT_MS without user activity.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
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

export const IDLE_TIMEOUT_MS = 10 * 60_000;
const REFRESH_INTERVAL_MS = 10_000;

export type MailboxPhase = "choose" | "checking" | "password" | "open";

export type MailboxNotice =
  | { kind: "error"; code: MailboxErrorCode | "listFailed" }
  | { kind: "saved"; count: number }
  | { kind: "deleted"; count: number }
  | { kind: "autoClosed" };

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

  const close = useCallback((why?: "autoClosed") => {
    // Boxes without a password go back to the list; others ask for the password again.
    const hadPassword = password.current !== null;
    password.current = null;
    generation.current++;
    setSession(null);
    setDocuments([]);
    setUpdatedAt(null);
    // Thumbnails and previews show private documents: drop them with the session.
    setThumbnails({});
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

  const refresh = useCallback(async () => {
    if (!selected) return;
    const result = password.current !== null ? await api.unlock(selected.number, password.current) : await api.open(selected.number);
    // Background refreshes stay quiet about transient failures; the list just isn't updated.
    if (result.ok && result.kind === "documents") {
      setSession(result.session);
      setDocuments(result.documents);
      setUpdatedAt(new Date());
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

  // Load the list of boxes once, then jump straight to "my" box if one is set.
  useEffect(() => {
    let cancelled = false;
    void api.list().then((result) => {
      if (cancelled) return;
      if (!result.ok) return setNotice({ kind: "error", code: "listFailed" });
      setBoxes(result.value);
      const mine = result.value.find((b) => b.number === loadMyMailbox());
      if (mine) void choose(mine);
    });
    return () => {
      cancelled = true;
    };
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      if (Date.now() - lastActivity.current > IDLE_TIMEOUT_MS) return close("autoClosed");
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      for (const e of events) window.removeEventListener(e, onActivity);
    };
  }, [phase, refresh, close]);

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
