/**
 * Show exactly what will be sent to the printer for one file, using the browser's own
 * PDF viewer (no PDF renderer of our own to download).
 */

import { useEffect, useState } from "preact/hooks";
import { useT } from "../../i18n";
import type { PrintOptions } from "../../printer/types";
import { buildMergedFile, buildPrintFile } from "../pdfJobs";
import type { PrintItem } from "../useSubmissions";
import { PdfDialog } from "./PdfDialog";

function PreviewContent(props: { item: PrintItem; options: PrintOptions; onClose: () => void; onRotate?: () => void }) {
  const { t } = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    buildPrintFile(props.item, props.options)
      .then(({ file }) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(file);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // Rebuilt when the file is rotated from inside the dialog; other options cannot change
    // while the (modal) dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.item.rotation]);

  const rotation = props.item.rotation;
  const actions = props.onRotate && (
    <button
      type="button"
      class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-rule bg-sheet px-3 py-1.5 text-sm font-semibold hover:bg-well"
      title={t("preview.rotateHint")}
      onClick={() => {
        setUrl(null); // Show "preparing" until the rotated file is ready.
        props.onRotate!();
      }}
    >
      <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M13 8a5 5 0 1 1-1.5-3.6" />
        <path d="M13 2.5V5h-2.5" />
      </svg>
      {t("preview.rotate")}
      {rotation ? <span class="tabular text-accent-ink">{rotation}°</span> : null}
    </button>
  );
  return <PdfDialog title={`${t("preview.title")}: ${props.item.file.name}`} subtitle={t("preview.note")} url={url} failed={failed} onClose={props.onClose} actions={actions} />;
}

export function PreviewDialog(props: { item: PrintItem | null; options: PrintOptions; onClose: () => void; onRotate?: (key: string) => void }) {
  // Keyed by file so reopening for another file starts fresh.
  const item = props.item;
  if (!item) return null;
  return <PreviewContent key={item.key} item={item} options={props.options} onClose={props.onClose} onRotate={props.onRotate && (() => props.onRotate!(item.key))} />;
}

/** Preview of several files merged into one job, in the order shown. */
export function MergedPreview(props: { items: PrintItem[]; options: PrintOptions; onClose: () => void }) {
  const { t } = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    buildMergedFile(props.items, props.options)
      .then(({ file }) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(file);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <PdfDialog title={t("files.mergedPreviewTitle", { count: props.items.length })} subtitle={t("preview.note")} url={url} failed={failed} onClose={props.onClose} />;
}
