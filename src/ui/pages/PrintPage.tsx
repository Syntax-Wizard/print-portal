import { useEffect, useMemo, useState } from "preact/hooks";
import { QueuePanel } from "../components/jobs";
import { formatTime, useT } from "../../i18n";
import { validateOptions } from "../../printer/options";
import type { PrintOptions } from "../../printer/types";
import { DropZone, FileList } from "../components/files";
import { OptionsForm } from "../components/OptionsForm";
import { SheetPreview } from "../components/SheetPreview";
import { PanelHeading, SupplyList, TrayList } from "../components/status";
import { cx } from "../components/controls";
import { usePrinter } from "../PrinterContext";
import { loadOptions, saveOptions } from "../settings";
import { type PrintItem, usePrintList } from "../useSubmissions";
import { MergedPreview } from "../components/PreviewDialog";
import { PreviewDialog } from "../components/PreviewDialog";
import { checkRange, isPdf, selectedPageCount } from "../pdfJobs";
import { sheetsNeeded } from "../../pdf/layout";

/** Ask for confirmation before printing many copies or sheets, to prevent accidental bulk prints. */
const LARGE_JOB_COPIES = 10;
const LARGE_JOB_SHEETS = 50;

/** Sheets of paper for the files waiting to print, or null while page counts are unknown. */
function estimateSheets(items: PrintItem[], o: PrintOptions, merge: boolean): number | null {
  const ready = items.filter((i) => i.status === "ready");
  if (ready.length === 0) return null;
  const copies = o.delivery.type === "sample" ? 1 : o.copies;
  if (merge && ready.length > 1) {
    // One job: pages run on across the files.
    let pages = 0;
    for (const item of ready) {
      const n = selectedPageCount(item);
      if (n === null) return null;
      pages += n;
    }
    return sheetsNeeded(pages, o.pagesPerSheet, o.duplex !== "none", copies);
  }
  let total = 0;
  for (const item of ready) {
    const pages = selectedPageCount(item);
    if (pages === null) return null;
    // Several pages per sheet applies to processed PDFs; a lone image is a single page anyway.
    const perSheet = isPdf(item.file) && !item.pdfIssue ? o.pagesPerSheet : 1;
    total += sheetsNeeded(pages, perSheet, o.duplex !== "none", copies);
  }
  return total;
}

function Summary({ o, sheets }: { o: PrintOptions; sheets: number | null }) {
  const { t, lang } = useT();
  const paper = o.paperSize === "default" ? t("summary.paperDefault") : t(`paperSize.${o.paperSize}`);
  const sentence = t("summary.sentence", {
    paper,
    color: t(`summary.color.${o.color}`),
    sides: t(`summary.sides.${o.duplex}`),
    copies_phrase: t("summary.copies", { count: o.delivery.type === "sample" ? 1 : o.copies }),
  });
  let extra = "";
  const d = o.delivery;
  if (d.type === "secure" || d.type === "sample") extra = t(`summary.delivery.${d.type}`);
  if (d.type === "delayed") {
    const at = new Date();
    at.setHours(d.hour, d.minute, 0, 0);
    extra = t("summary.delivery.delayed", { time: formatTime(at, lang) });
  }
  return (
    <p class="m-0 text-sm leading-relaxed text-ink-soft">
      <span class="text-ink">{sentence}</span>
      {o.pagesPerSheet > 1 && <span class="text-ink"> {t("summary.pagesPerSheet", { count: o.pagesPerSheet })}</span>}
      {sheets !== null && <span class="mt-1 block tabular">{t("summary.sheets", { count: sheets })}</span>}
      {extra && <span class="mt-1 block font-semibold text-accent-ink">{extra}</span>}
    </p>
  );
}

export function PrintPage() {
  const { t } = useT();
  const { status } = usePrinter();
  const [options, setOptions] = useState<PrintOptions>(loadOptions);
  const [showErrors, setShowErrors] = useState(false);
  const { items, busy, tooMany, addFiles, remove, move, clearDone, print, setPageRange, rotate } = usePrintList();
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [merge, setMerge] = useState(false);
  const [mergedPreview, setMergedPreview] = useState(false);
  const [confirmingLarge, setConfirmingLarge] = useState(false);

  useEffect(() => saveOptions(options), [options]);

  // Paste a screenshot (⌘V / Ctrl+V) to print it. Typing in a text field keeps normal pasting.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest("input, textarea, [contenteditable]")) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
      if (files.length === 0) return;
      e.preventDefault();
      // Clipboard images are all called "image.png": give each a recognisable, unique name.
      // Local time, like the screenshot tools themselves: 20261125-174030.
      const now = new Date();
      const two = (n: number) => String(n).padStart(2, "0");
      const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
      addFiles(files.map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `screenshot-${stamp}${files.length > 1 ? `-${i + 1}` : ""}.${f.type.split("/")[1] || "png"}`, { type: f.type }))));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  const errors = useMemo(() => validateOptions(options), [options]);
  const readyCount = items.filter((i) => i.status === "ready").length;
  // A page selection that doesn't parse would otherwise be silently ignored.
  const rangeBlocked = items.some((i) => i.status === "ready" && checkRange(i)?.ok === false);
  const readyItems = items.filter((i) => i.status === "ready" && !i.problem);
  // Merging only makes sense with two or more files ready to print.
  const merging = merge && readyItems.length > 1;
  const sheets = useMemo(() => estimateSheets(items, options, merging), [items, options, merging]);
  const trays = status.data?.trays ?? [];
  const effectiveCopies = options.delivery.type === "sample" ? 1 : options.copies;
  const isLargeJob = effectiveCopies >= LARGE_JOB_COPIES || (sheets !== null && sheets >= LARGE_JOB_SHEETS);

  useEffect(() => setConfirmingLarge(false), [options, readyCount, merging]);

  const doPrint = () => {
    setConfirmingLarge(false);
    setShowErrors(false);
    void print(options, { merge: merging });
  };

  const onPrint = () => {
    if (errors.length) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    if (isLargeJob) {
      setConfirmingLarge(true);
      return;
    }
    doPrint();
  };

  const onRetry = (key: string) => {
    if (errors.length) {
      setShowErrors(true);
      return;
    }
    void print(options, { onlyKey: key });
  };

  const buttonLabel = busy ? t("submit.busy") : merging ? t("submit.mergedButton", { count: readyCount }) : readyCount > 0 ? t("submit.button", { count: readyCount }) : t("submit.buttonEmpty");
  const buttonClass = (enabled: boolean) =>
    cx(
      "inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold tracking-tight transition-all sm:text-[15px]",
      enabled
        ? "cursor-pointer bg-accent text-on-accent shadow-[0_2px_8px_rgb(2_132_199/0.3)] hover:bg-accent-hover active:scale-[0.99]"
        : "cursor-not-allowed bg-well text-ink-faint",
    );
  const canPrint = readyCount > 0 && !busy && !rangeBlocked;
  const confirmMessage =
    sheets !== null
      ? effectiveCopies > 1
        ? t("submit.confirmLarge", { sheets, copies: effectiveCopies })
        : t("submit.confirmLargeSheets", { sheets })
      : t("submit.confirmLargeCopies", { copies: effectiveCopies });

  const confirmBox = (
    <div class="flex flex-col gap-2.5 rounded-xl border border-warn/40 bg-warn-wash/75 p-3.5" role="alertdialog" aria-label={confirmMessage}>
      <p class="m-0 text-xs leading-relaxed font-semibold text-warn">{confirmMessage}</p>
      <div class="flex gap-2">
        <button
          type="button"
          class="flex-1 cursor-pointer rounded-lg bg-accent px-3 py-2 text-xs font-bold text-on-accent transition-colors hover:bg-accent-hover"
          onClick={doPrint}
        >
          {t("submit.confirmYes")}
        </button>
        <button
          type="button"
          class="cursor-pointer rounded-lg border border-rule bg-sheet px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-well"
          onClick={() => setConfirmingLarge(false)}
        >
          {t("submit.confirmCancel")}
        </button>
      </div>
    </div>
  );

  return (
    <div class={cx("grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] xl:grid-cols-[minmax(0,1fr)_22.5rem]", (readyCount > 0 || busy) && "pb-24 lg:pb-0")}>
      {(readyCount > 0 || busy) && (
        // On narrow screens the main button sits far below the settings; this bar keeps it in reach.
        <div class="fixed inset-x-0 bottom-0 z-10 border-t border-rule bg-sheet/92 px-4 py-3 shadow-[0_-4px_16px_rgb(15_23_42/0.08)] backdrop-blur-md lg:hidden">
          {confirmingLarge ? (
            confirmBox
          ) : (
            <button type="button" class={buttonClass(canPrint)} disabled={!canPrint} onClick={onPrint}>
              {buttonLabel}
            </button>
          )}
        </div>
      )}
      <div class="flex min-w-0 flex-col gap-5">
        <DropZone onFiles={addFiles} compact={items.length > 0} />
        <FileList
          items={items}
          onRemove={remove}
          onRetry={onRetry}
          onClearDone={clearDone}
          onRangeChange={setPageRange}
          onPreview={setPreviewKey}
          onMove={merging ? move : undefined}
          onRotate={rotate}
          tooMany={tooMany}
        />
        {readyItems.length > 1 && (
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
            <label class="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold">
              <input type="checkbox" class="h-4 w-4 accent-[var(--color-accent)]" checked={merge} onChange={(e) => setMerge((e.currentTarget as HTMLInputElement).checked)} />
              {t("files.merge")}
            </label>
            {merging && (
              <button type="button" class="cursor-pointer rounded-lg px-2 py-1 text-xs font-semibold text-accent-ink hover:bg-accent-wash" onClick={() => setMergedPreview(true)}>
                {t("files.mergedPreview")}
              </button>
            )}
            <p class="m-0 w-full text-xs text-ink-faint">{merging ? t("files.mergeOrderHint") : t("files.mergeHint")}</p>
          </div>
        )}
        {mergedPreview && <MergedPreview items={readyItems} options={options} onClose={() => setMergedPreview(false)} />}
        <PreviewDialog item={items.find((i) => i.key === previewKey) ?? null} options={options} onClose={() => setPreviewKey(null)} />
        <section aria-labelledby="settings-heading" class="card p-5 sm:p-6">
          <h2 id="settings-heading" class="m-0 mb-4 text-base font-bold tracking-tight text-ink">
            {t("options.title")}
          </h2>
          <OptionsForm options={options} onChange={setOptions} trays={trays} errors={showErrors ? errors : []} />
        </section>
      </div>

      <aside class="flex flex-col gap-5 lg:sticky lg:top-20 lg:self-start">
        <section class="card flex flex-col gap-4 p-5">
          <SheetPreview options={options} label={t("summary.previewLabel")} />
          <Summary o={options} sheets={sheets} />
          {confirmingLarge ? (
            confirmBox
          ) : (
            <button type="button" class={buttonClass(canPrint)} disabled={!canPrint} onClick={onPrint}>
              <svg class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M5 7V3.5h10V7" />
                <rect x="3" y="7" width="14" height="7" rx="2" />
                <path d="M6 12h8v4.5H6V12Z" />
              </svg>
              {buttonLabel}
            </button>
          )}
          {readyCount === 0 && !busy && <p class="m-0 -mt-1.5 text-center text-xs text-ink-faint">{t("submit.noFiles")}</p>}
          {showErrors && errors.length > 0 && <p class="m-0 -mt-1.5 text-center text-xs font-medium text-error">{t("submit.fixErrors")}</p>}
          {rangeBlocked && <p class="m-0 -mt-1.5 text-center text-xs font-medium text-error">{t("submit.fixRanges")}</p>}
        </section>

        <QueuePanel />

        {status.data && (
          <section class="card flex flex-col gap-5 p-5">
            <div>
              <PanelHeading>{t("supplies.title")}</PanelHeading>
              <SupplyList supplies={status.data.supplies} kind="toner" compact />
            </div>
            <div class="border-t border-rule/80 pt-4">
              <PanelHeading>{t("trays.title")}</PanelHeading>
              <TrayList trays={trays} />
            </div>
            {status.updatedAt && (
              <div class="border-t border-rule/70 pt-3">
                <UpdatedAt at={status.updatedAt} onRefresh={status.refresh} />
              </div>
            )}
          </section>
        )}
        {status.error !== undefined && !status.data && (
          <p class="card m-0 border-error/30 bg-error-wash/60 p-4 text-sm font-medium text-error">{t("errors.statusUnavailable")}</p>
        )}
      </aside>
    </div>
  );
}

export function UpdatedAt(props: { at: Date; onRefresh: () => void }) {
  const { t, lang } = useT();
  return (
    <p class="m-0 flex items-center justify-between gap-2 text-xs text-ink-faint">
      <span class="tabular">{t("device.updatedAt", { time: formatTime(props.at, lang) })}</span>
      <button
        type="button"
        class="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 font-semibold text-accent-ink transition-colors hover:bg-accent-wash"
        onClick={props.onRefresh}
      >
        <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M13.5 8a5.5 5.5 0 1 1-1.4-3.7" />
          <path d="M13.5 2.5v2.8h-2.8" />
        </svg>
        {t("device.refresh")}
      </button>
    </p>
  );
}
