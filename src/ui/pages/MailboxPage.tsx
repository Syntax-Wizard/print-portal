import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { formatDateTime, formatTime, useT } from "../../i18n";
import { type MailboxDocument, type MailboxSummary, type RetrieveFormat, isRetrievable } from "../../printer/mailbox";
import { cx } from "../components/controls";
import { usePrinter } from "../PrinterContext";
import { type Mailbox, type MailboxNotice, type Thumbnail, useMailboxContext } from "../useMailbox";
import { usePrintList } from "../useSubmissions";
import { PdfDialog } from "../components/PdfDialog";

/** The printer shows box numbers with three digits (027). */
const boxNumber = (n: number) => String(n).padStart(3, "0");

const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-bold text-on-accent shadow-[0_2px_8px_rgb(2_132_199/0.3)] transition-all hover:bg-accent-hover active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-well disabled:text-ink-faint disabled:shadow-none";
const secondaryButton =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-rule bg-sheet px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-well disabled:cursor-not-allowed disabled:text-ink-faint";
const dangerButton =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-error/40 bg-sheet px-3 py-1.5 text-sm font-semibold text-error transition-colors hover:bg-error-wash disabled:cursor-not-allowed disabled:border-rule disabled:text-ink-faint";

function Notice({ notice }: { notice: MailboxNotice | null }) {
  const { t } = useT();
  if (!notice) return null;
  let text: string;
  switch (notice.kind) {
    case "error":
      text = t(`mailbox.errors.${notice.code}`);
      break;
    case "autoClosed":
      text = t("mailbox.autoClosed");
      break;
    case "receiveEnded":
      text = t("mailbox.receive.ended");
      break;
    case "archived":
      text = t(notice.deleted ? "mailbox.archivedDeleted" : "mailbox.archived", { count: notice.count });
      break;
    default:
      text = t(`mailbox.${notice.kind}`, { count: notice.count });
  }
  const quiet = notice.kind === "autoClosed" || notice.kind === "receiveEnded";
  const tone = notice.kind === "error" ? "border-error/30 bg-error-wash/60 text-error" : quiet ? "border-rule bg-well/60 text-ink-soft" : "border-ok/30 bg-ok-wash/60 text-ok";
  return (
    <p class={cx("m-0 rounded-xl border px-4 py-3 text-sm font-medium", tone)} role={notice.kind === "error" ? "alert" : "status"}>
      {text}
    </p>
  );
}

function BoxChooser(props: { boxes: MailboxSummary[] | null; myBox: number | null; onChoose: (b: MailboxSummary) => void }) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = props.boxes ?? [];
    if (!q) return all;
    return all.filter((b) => boxNumber(b.number).includes(q) || String(b.number) === q || b.name.toLowerCase().includes(q));
  }, [props.boxes, query]);

  return (
    <section class="card p-5 sm:p-6" aria-labelledby="mb-choose">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 id="mb-choose" class="m-0 text-sm font-bold tracking-tight">
          {t("mailbox.chooseTitle")}
        </h2>
        <input
          type="search"
          class="w-full max-w-xs rounded-lg border border-rule bg-sheet px-3 py-1.5 text-sm text-ink"
          placeholder={t("mailbox.search")}
          aria-label={t("mailbox.search")}
          value={query}
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
      {props.boxes && list.length === 0 && <p class="m-0 mt-4 text-sm text-ink-soft">{t("mailbox.noMatch")}</p>}
      <ul class="m-0 mt-4 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((b) => (
          <li key={b.number}>
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-xl border border-rule bg-sheet px-3.5 py-2.5 text-left transition-colors hover:border-accent/50 hover:bg-accent-wash/30"
              onClick={() => props.onChoose(b)}
            >
              <span class="tabular rounded-md bg-well px-1.5 py-0.5 text-xs font-bold text-ink-soft">{boxNumber(b.number)}</span>
              <span class="min-w-0 flex-1 truncate text-sm font-semibold">{b.name}</span>
              {props.myBox === b.number && <span class="rounded-full bg-accent-wash px-2 py-0.5 text-[11px] font-bold text-accent-ink">{t("mailbox.mine")}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PasswordForm(props: { box: MailboxSummary; busy: boolean; onSubmit: (password: string) => void }) {
  const { t } = useT();
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <form
      class="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (value) props.onSubmit(value);
        setValue("");
      }}
    >
      <label class="text-sm font-semibold text-ink-soft" for="mb-password">
        {t("mailbox.password")}
      </label>
      <div class="flex flex-wrap gap-2">
        <input
          ref={input}
          id="mb-password"
          type="password"
          autoComplete="off"
          class="w-full max-w-xs rounded-lg border border-rule bg-sheet px-3 py-2 text-sm text-ink"
          value={value}
          onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
        />
        <button type="submit" class={primaryButton} disabled={!value || props.busy}>
          {props.busy ? t("mailbox.opening") : t("mailbox.open")}
        </button>
      </div>
      <p class="m-0 max-w-prose text-xs leading-relaxed text-ink-faint">
        {t("mailbox.passwordNote")}
      </p>
    </form>
  );
}

/** First page of the document; clicking it opens the preview. */
function ThumbnailButton(props: { thumb: Thumbnail | undefined; viewable: boolean; name: string; onView: () => void }) {
  const { t } = useT();
  const frame = "grid h-[72px] w-[54px] shrink-0 place-items-center overflow-hidden rounded-md border border-rule bg-sheet";
  if (!props.viewable) {
    return (
      <span class={cx(frame, "text-[10px] font-bold text-ink-faint")} title={t("mailbox.cannotView")} aria-hidden="true">
        PDF
      </span>
    );
  }
  const thumb = props.thumb;
  return (
    <button type="button" class={cx(frame, "cursor-pointer p-0 transition-shadow hover:ring-2 hover:ring-accent/50")} onClick={props.onView} aria-label={t("mailbox.thumbnailOf", { name: props.name })}>
      {thumb?.kind === "ready" ? (
        <img src={thumb.url} alt="" class="h-full w-full object-cover object-top" />
      ) : (
        <span class={cx("h-full w-full", thumb?.kind === "failed" ? "bg-well" : "animate-pulse bg-well")} aria-hidden="true" />
      )}
    </button>
  );
}

function RenameForm(props: { initial: string; onDone: (label: string | null) => void }) {
  const { t } = useT();
  const [value, setValue] = useState(props.initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);
  return (
    <form
      class="mt-1 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        props.onDone(value);
      }}
    >
      <input
        ref={input}
        type="text"
        maxLength={80}
        aria-label={t("mailbox.renameLabel")}
        placeholder={t("mailbox.renamePlaceholder")}
        class="w-full max-w-xs rounded-lg border border-rule bg-sheet px-2.5 py-1 text-sm text-ink"
        value={value}
        onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => e.key === "Escape" && props.onDone(null)}
      />
      <button type="submit" class={secondaryButton}>
        {t("mailbox.renameApply")}
      </button>
      <button type="button" class={secondaryButton} onClick={() => props.onDone(null)}>
        {t("mailbox.cancel")}
      </button>
      <p class="m-0 w-full text-[11px] text-ink-faint">{t("mailbox.renameNote")}</p>
    </form>
  );
}

function DocumentRow(props: {
  doc: MailboxDocument;
  label: string | undefined;
  thumb: Thumbnail | undefined;
  checked: boolean;
  onToggle: () => void;
  onSave: () => void;
  onView: () => void;
  onRename: (label: string) => void;
  saving: boolean;
}) {
  const { t, lang } = useT();
  const { doc } = props;
  const [renaming, setRenaming] = useState(false);
  const when = doc.storedAt ? formatDateTime(doc.storedAt, lang) : doc.name;
  const title = props.label ?? when;
  const viewable = isRetrievable(doc);
  return (
    <li class={cx("flex items-center gap-3 px-4 py-3 transition-colors", props.checked && "bg-accent-wash/40")}>
      <input type="checkbox" class="h-4 w-4 shrink-0 accent-[var(--color-accent)]" checked={props.checked} onChange={props.onToggle} aria-label={t("mailbox.selectDocument", { name: title })} />
      <ThumbnailButton thumb={props.thumb} viewable={viewable} name={title} onView={props.onView} />
      <div class="min-w-0 flex-1">
        {renaming ? (
          <RenameForm
            initial={props.label ?? ""}
            onDone={(label) => {
              if (label !== null) props.onRename(label);
              setRenaming(false);
            }}
          />
        ) : (
          <>
            <p class="m-0 flex items-center gap-1.5">
              <span class={cx("truncate text-sm font-semibold", !props.label && "tabular")}>{title}</span>
              <button type="button" class="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-xs font-medium text-accent-ink hover:bg-accent-wash" onClick={() => setRenaming(true)}>
                {t("mailbox.rename")}
              </button>
            </p>
            <p class="m-0 flex flex-wrap gap-x-3 text-xs text-ink-soft">
              {props.label && <span class="tabular">{t("mailbox.scannedAt", { time: when })}</span>}
              <span>{doc.pages !== null ? t("mailbox.pages", { count: doc.pages }) : "—"}</span>
              <span>{t(`mailbox.type.${doc.type}`)}</span>
              <span class="tabular text-ink-faint">{doc.name}</span>
            </p>
          </>
        )}
      </div>
      {viewable && (
        <button type="button" class={secondaryButton} onClick={props.onView}>
          {t("mailbox.view")}
        </button>
      )}
      <button type="button" class={secondaryButton} disabled={props.saving} onClick={props.onSave}>
        {t("mailbox.save")}
      </button>
    </li>
  );
}

function ReceivePanel(props: { mb: Mailbox }) {
  const { t, lang } = useT();
  const { mb } = props;
  const r = mb.receiving;
  if (!r) {
    return (
      <div class="flex flex-wrap items-center gap-3 rounded-xl border border-rule bg-well/40 px-4 py-3">
        <div class="min-w-0 flex-1">
          <p class="m-0 text-sm font-semibold">{t("mailbox.receive.title")}</p>
          <p class="m-0 text-xs text-ink-soft">{t("mailbox.receive.description")}</p>
        </div>
        <button type="button" class={primaryButton} onClick={() => mb.startReceiving(false)}>
          {t("mailbox.receive.start")}
        </button>
      </div>
    );
  }
  return (
    <section class="flex flex-col gap-2 rounded-xl border border-accent/40 bg-accent-wash/40 px-4 py-3" aria-live="polite">
      <div class="flex flex-wrap items-center gap-3">
        <span class="h-2.5 w-2.5 animate-pulse rounded-full bg-accent" aria-hidden="true" />
        <p class="m-0 flex-1 text-sm font-semibold">{t("mailbox.receive.waiting", { time: formatTime(new Date(r.until), lang) })}</p>
        <button type="button" class={secondaryButton} onClick={mb.stopReceiving}>
          {t("mailbox.receive.stop")}
        </button>
      </div>
      <label class="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" class="h-4 w-4 accent-[var(--color-accent)]" checked={r.deleteAfter} onChange={(e) => mb.setReceiveDelete((e.currentTarget as HTMLInputElement).checked)} />
        {t("mailbox.receive.deleteAfter")}
      </label>
      <p class="m-0 text-xs text-ink-faint">{t("mailbox.receive.downloadHint")}</p>
      <div>
        <p class="m-0 text-xs font-semibold text-ink-soft">{t("mailbox.receive.received")}</p>
        {r.received.length === 0 ? (
          <p class="m-0 text-xs text-ink-soft">{t("mailbox.receive.none")}</p>
        ) : (
          <ul class="m-0 list-none p-0 text-sm">
            {r.received.map((name, i) => (
              <li key={`${name}-${i}`} class="tabular">
                ✓ {name}
              </li>
            ))}
          </ul>
        )}
        {r.pendingDeletes > 0 && <p class="m-0 mt-1 text-xs text-warn">{t("mailbox.receive.pendingDeletes", { count: r.pendingDeletes })}</p>}
      </div>
    </section>
  );
}

function OpenBox(props: { mb: Mailbox }) {
  const { t, lang } = useT();
  const { status } = usePrinter();
  const { mb } = props;
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [format, setFormat] = useState<RetrieveFormat>("pdf");
  const [confirming, setConfirming] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleteAfterArchive, setDeleteAfterArchive] = useState(false);
  const { addFiles } = usePrintList();

  // Drop selections for documents that disappeared.
  useEffect(() => {
    setChecked((prev) => new Set([...prev].filter((id) => mb.documents.some((d) => d.id === id))));
  }, [mb.documents]);

  const ids = [...checked];
  const allChecked = mb.documents.length > 0 && checked.size === mb.documents.length;
  const panelInUse = status.data?.device.state === "panelInUse";

  return (
    <div class="flex flex-col gap-4">
      <ReceivePanel mb={mb} />
      <div class="flex flex-wrap items-center gap-3">
        <label class="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            class="h-4 w-4 accent-[var(--color-accent)]"
            checked={allChecked}
            disabled={mb.documents.length === 0}
            onChange={() => setChecked(allChecked ? new Set() : new Set(mb.documents.map((d) => d.id)))}
          />
          {t("mailbox.selectAll")}
        </label>
        <label class="flex items-center gap-2 text-sm text-ink-soft">
          {t("mailbox.format.label")}
          <select class="rounded-lg border border-rule bg-sheet px-2 py-1 text-sm text-ink" value={format} onChange={(e) => setFormat((e.currentTarget as HTMLSelectElement).value as RetrieveFormat)}>
            <option value="pdf">{t("mailbox.format.pdf")}</option>
            <option value="tiffJpeg">{t("mailbox.format.tiffJpeg")}</option>
          </select>
        </label>
        <div class="ml-auto flex flex-wrap gap-2">
          <button type="button" class={secondaryButton} disabled={ids.length === 0 || mb.busy !== null} onClick={() => void mb.save(ids, format)}>
            {mb.busy === "saving" ? t("mailbox.saving") : t("mailbox.saveSelected", { count: ids.length })}
          </button>
          <button type="button" class={secondaryButton} disabled={ids.length === 0 || mb.busy !== null} onClick={() => setArchiving(true)}>
            {t("mailbox.archiveSelected", { count: ids.length })}
          </button>
          <button
            type="button"
            class={secondaryButton}
            disabled={ids.length === 0 || mb.busy !== null}
            onClick={async () => {
              // Documents join the print list, where every print option is available.
              if (await mb.sendToPrint(ids, addFiles)) location.hash = "/print";
            }}
          >
            {t("mailbox.sendToPrint", { count: ids.length })}
          </button>
          <button type="button" class={dangerButton} disabled={ids.length === 0 || mb.busy !== null} onClick={() => setConfirming(true)}>
            {t("mailbox.deleteSelected", { count: ids.length })}
          </button>
        </div>
      </div>

      {archiving && ids.length > 0 && (
        <div class="flex flex-wrap items-center gap-3 rounded-xl border border-rule bg-well/50 px-4 py-3">
          <p class="m-0 text-sm font-semibold">{t("mailbox.archiveSelected", { count: ids.length })}</p>
          <label class="inline-flex flex-1 items-center gap-2 text-sm">
            <input type="checkbox" class="h-4 w-4 accent-[var(--color-accent)]" checked={deleteAfterArchive} onChange={(e) => setDeleteAfterArchive((e.currentTarget as HTMLInputElement).checked)} />
            {t("mailbox.archiveDeleteAfter")}
          </label>
          <button
            type="button"
            class={deleteAfterArchive ? dangerButton : secondaryButton}
            disabled={mb.busy !== null}
            onClick={async () => {
              await mb.archive(ids, deleteAfterArchive);
              setArchiving(false);
              if (deleteAfterArchive) setChecked(new Set());
            }}
          >
            {mb.busy === "saving" ? t("mailbox.saving") : t("mailbox.archiveRun")}
          </button>
          <button type="button" class={secondaryButton} onClick={() => setArchiving(false)}>
            {t("mailbox.cancel")}
          </button>
        </div>
      )}

      {confirming && ids.length > 0 && (
        <div class="flex flex-wrap items-center gap-3 rounded-xl border border-error/30 bg-error-wash/50 px-4 py-3" role="alertdialog" aria-labelledby="mb-confirm">
          <p id="mb-confirm" class="m-0 flex-1 text-sm font-semibold text-error">
            {t("mailbox.confirmDelete", { count: ids.length })}
          </p>
          <button
            type="button"
            class={dangerButton}
            disabled={mb.busy !== null}
            onClick={async () => {
              if (await mb.remove(ids)) setChecked(new Set());
              setConfirming(false);
            }}
          >
            {mb.busy === "deleting" ? t("mailbox.deleting") : t("mailbox.confirmDeleteYes")}
          </button>
          <button type="button" class={secondaryButton} onClick={() => setConfirming(false)}>
            {t("mailbox.cancel")}
          </button>
        </div>
      )}

      {panelInUse && <p class="m-0 text-xs font-medium text-warn">{t("mailbox.panelInUseHint")}</p>}

      {mb.documents.length === 0 ? (
        <p class="m-0 rounded-xl border border-dashed border-rule-strong px-4 py-8 text-center text-sm text-ink-soft">{t("mailbox.empty")}</p>
      ) : (
        <ul class="m-0 list-none divide-y divide-rule overflow-hidden rounded-xl border border-rule p-0" aria-live="polite">
          {mb.documents.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              label={mb.labels[doc.name]}
              thumb={mb.session ? mb.thumbnails[`${mb.session.box}:${doc.name}`] : undefined}
              onView={() => void mb.openPreview(doc)}
              onRename={(label) => mb.rename(doc, label)}
              checked={checked.has(doc.id)}
              saving={mb.busy !== null}
              onToggle={() =>
                setChecked((prev) => {
                  const next = new Set(prev);
                  if (next.has(doc.id)) next.delete(doc.id);
                  else next.add(doc.id);
                  return next;
                })
              }
              onSave={() => void mb.save([doc.id], format)}
            />
          ))}
        </ul>
      )}

      {mb.updatedAt && (
        <p class="m-0 text-xs text-ink-faint">
          {t("device.updatedAt", { time: formatTime(mb.updatedAt, lang) })}　{mb.receiving ? null : t("mailbox.idleNote")}
        </p>
      )}

      {mb.preview && (
        <PdfDialog
          title={mb.labels[mb.preview.doc.name] ?? (mb.preview.doc.storedAt ? formatDateTime(mb.preview.doc.storedAt, lang) : mb.preview.doc.name)}
          subtitle={[mb.preview.doc.pages !== null ? t("mailbox.pages", { count: mb.preview.doc.pages }) : null, mb.preview.doc.name].filter(Boolean).join("　")}
          url={mb.preview.url}
          failed={mb.preview.failed}
          onClose={mb.closePreview}
          actions={
            <button type="button" class={secondaryButton} disabled={mb.busy !== null} onClick={() => void mb.save([mb.preview!.doc.id], format)}>
              {t("mailbox.save")}
            </button>
          }
        />
      )}
    </div>
  );
}

export function MailboxPage() {
  const { t } = useT();
  const mb = useMailboxContext();
  // The first visit loads the list of boxes (and opens "my" box).
  useEffect(() => mb.activate(), [mb.activate]);
  const box = mb.selected;
  const openingMine = mb.myBox !== null && mb.boxes === null && !box && mb.notice?.kind !== "error";

  return (
    <div class="flex max-w-4xl flex-col gap-6">
      <p class="m-0 max-w-prose text-sm text-ink-soft">{t("mailbox.intro")}</p>
      <Notice notice={mb.notice} />

      {/* With "my" box set, the first visit opens it as soon as the list arrives: show that rather
          than flashing the chooser for the moment the list takes. A failed load shows the chooser. */}
      {openingMine && (
        <section class="card flex items-center gap-3 p-5 text-sm text-ink-soft sm:p-6" aria-live="polite">
          <span class="h-4 w-4 animate-spin rounded-full border-2 border-rule border-t-accent" aria-hidden="true" />
          {t("mailbox.openingMine", { number: boxNumber(mb.myBox!) })}
        </section>
      )}
      {!openingMine && (mb.phase === "choose" || !box) && <BoxChooser boxes={mb.boxes} myBox={mb.myBox} onChoose={(b) => void mb.choose(b)} />}

      {box && mb.phase !== "choose" && (
        <section class="card flex flex-col gap-5 p-5 sm:p-6" aria-labelledby="mb-title">
          <div class="flex flex-wrap items-center gap-3">
            <span class="tabular rounded-md bg-well px-2 py-0.5 text-sm font-bold text-ink-soft">{boxNumber(box.number)}</span>
            <h2 id="mb-title" class="m-0 text-base font-bold tracking-tight">
              {box.name}
            </h2>
            {mb.phase === "open" && <span class="text-sm text-ink-soft">{t("mailbox.documents", { count: mb.documents.length })}</span>}
            <div class="ml-auto flex flex-wrap gap-2">
              <button type="button" class={secondaryButton} onClick={() => mb.setMyBox(mb.myBox === box.number ? null : box.number)}>
                {mb.myBox === box.number ? t("mailbox.unsetMine") : t("mailbox.setMine")}
              </button>
              {mb.phase === "open" && (
                <button type="button" class={secondaryButton} onClick={() => mb.close()}>
                  {t("mailbox.close")}
                </button>
              )}
              <button type="button" class={secondaryButton} onClick={mb.back}>
                {t("mailbox.change")}
              </button>
            </div>
          </div>
          {mb.phase === "checking" && <p class="m-0 text-sm text-ink-soft">{t("mailbox.opening")}</p>}
          {mb.phase === "password" && <PasswordForm box={box} busy={mb.busy === "opening"} onSubmit={(p) => void mb.unlock(p)} />}
          {mb.phase === "open" && <OpenBox mb={mb} />}
        </section>
      )}
    </div>
  );
}
