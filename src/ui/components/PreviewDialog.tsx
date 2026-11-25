/**
 * Show exactly what will be sent to the printer for one file, using the browser's own
 * PDF viewer in an iframe (no PDF renderer of our own to download).
 */

import { useEffect, useRef, useState } from "preact/hooks";
import { useT } from "../../i18n";
import type { PrintOptions } from "../../printer/types";
import { buildPrintFile } from "../pdfJobs";
import type { PrintItem } from "../useSubmissions";

export function PreviewDialog(props: { item: PrintItem | null; options: PrintOptions; onClose: () => void }) {
  const { t } = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const { item, options } = props;

  useEffect(() => {
    if (!item) return;
    dialog.current?.showModal();
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    buildPrintFile(item, options)
      .then((file) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(file);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // Rebuild only when another file is opened; the dialog is modal, so options cannot change meanwhile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.key]);

  if (!item) return null;
  return (
    <dialog
      ref={dialog}
      class="m-auto h-[min(90vh,60rem)] w-[min(94vw,56rem)] overflow-hidden rounded-2xl border border-rule bg-sheet p-0 text-ink shadow-2xl backdrop:bg-black/40"
      aria-labelledby="preview-title"
      onClose={props.onClose}
    >
      <div class="flex h-full flex-col">
        <div class="flex items-center gap-3 border-b border-rule px-5 py-3">
          <div class="min-w-0 flex-1">
            <h2 id="preview-title" class="m-0 truncate text-sm font-bold">
              {t("preview.title")}: {item.file.name}
            </h2>
            <p class="m-0 text-xs text-ink-soft">{t("preview.note")}</p>
          </div>
          <button type="button" class="cursor-pointer rounded-lg border border-rule bg-sheet px-3 py-1.5 text-sm font-semibold hover:bg-well" onClick={() => dialog.current?.close()}>
            {t("preview.close")}
          </button>
        </div>
        <div class="flex-1 bg-well">
          {url ? (
            <iframe src={url} title={item.file.name} class="h-full w-full border-0" />
          ) : (
            <p class={failed ? "m-6 text-sm font-medium text-error" : "m-6 text-sm text-ink-soft"}>{failed ? t("preview.failed") : t("preview.loading")}</p>
          )}
        </div>
      </div>
    </dialog>
  );
}
