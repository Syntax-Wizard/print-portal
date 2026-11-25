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

  const close = useCallback((why?: "autoClosed") => {
    // Boxes without a password go back to the list; others ask for the password again.
    const hadPassword = password.current !== null;
    password.current = null;
    setSession(null);
    setDocuments([]);
    setUpdatedAt(null);
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
          saveBlob(file.value, link.fileName);
        }
        setNotice({ kind: "saved", count: links.value.length });
        // Some boxes delete documents once retrieved; show the printer's current state.
        void refresh();
      } finally {
        setBusy(null);
      }
    },
    [api, session, refresh],
  );

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

  return { boxes, myBox, setMyBox, selected, phase, session, documents, updatedAt, notice, busy, choose, unlock, refresh, save, remove, back, close };
}
