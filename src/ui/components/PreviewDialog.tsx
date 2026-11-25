/**
 * Show exactly what will be sent to the printer for one file, using the browser's own
 * PDF viewer (no PDF renderer of our own to download).
 */

import { useEffect, useState } from "preact/hooks";
import { useT } from "../../i18n";
import type { PrintOptions } from "../../printer/types";
import { buildPrintFile } from "../pdfJobs";
import type { PrintItem } from "../useSubmissions";
import { PdfDialog } from "./PdfDialog";

function PreviewContent(props: { item: PrintItem; options: PrintOptions; onClose: () => void }) {
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
    // Built once per opening; the dialog is modal, so options cannot change meanwhile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <PdfDialog title={`${t("preview.title")}: ${props.item.file.name}`} subtitle={t("preview.note")} url={url} failed={failed} onClose={props.onClose} />;
}

export function PreviewDialog(props: { item: PrintItem | null; options: PrintOptions; onClose: () => void }) {
  // Keyed by file so reopening for another file starts fresh.
  return props.item ? <PreviewContent key={props.item.key} item={props.item} options={props.options} onClose={props.onClose} /> : null;
}
