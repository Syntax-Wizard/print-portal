/**
 * Display names for mailbox documents, kept in this browser only.
 *
 * The printer's web interface cannot rename documents (verified: no such operation on the
 * document list or box settings pages), and its own names are scan timestamps such as
 * 20261125155253. Labels are keyed by box number and that printer name, which is unique
 * within a box.
 */

const KEY = "printPortal.mailboxLabels";
const MAX_LENGTH = 80;

type Store = Record<string, Record<string, string>>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Storage unavailable: labels just aren't remembered.
  }
}

export function loadLabels(box: number): Record<string, string> {
  return { ...(read()[String(box)] ?? {}) };
}

/** Set or (with an empty label) remove a document's display name. Returns the box's labels. */
export function saveLabel(box: number, documentName: string, label: string): Record<string, string> {
  const store = read();
  const labels = { ...(store[String(box)] ?? {}) };
  const clean = label.replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH);
  if (clean) labels[documentName] = clean;
  else delete labels[documentName];
  store[String(box)] = labels;
  write(store);
  return labels;
}

/**
 * Forget labels of documents that are gone. Only call this with a complete list: the printer
 * returns at most 100 documents per page.
 */
export function pruneLabels(box: number, existing: readonly string[]): Record<string, string> {
  const store = read();
  const labels = store[String(box)];
  if (!labels) return {};
  const keep = new Set(existing);
  const pruned = Object.fromEntries(Object.entries(labels).filter(([name]) => keep.has(name)));
  if (Object.keys(pruned).length !== Object.keys(labels).length) {
    store[String(box)] = pruned;
    write(store);
  }
  return pruned;
}

/** A safe file name from a label, keeping the extension of the printer's file name. */
export function downloadName(label: string | undefined, printerFileName: string): string {
  if (!label) return printerFileName;
  const ext = /\.[A-Za-z0-9]{1,5}$/.exec(printerFileName)?.[0] ?? "";
  const base = label.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim().slice(0, MAX_LENGTH);
  return (base || "document") + ext;
}
