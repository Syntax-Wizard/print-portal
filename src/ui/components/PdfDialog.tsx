/**
 * Modal that shows a PDF: in the portal's own page viewer (print previews) or in the browser's
 * viewer (mailbox documents, where its download button is useful). Opens when mounted, calls
 * onClose when dismissed.
 */

import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useT } from "../../i18n";
import { PageViewer } from "./PageViewer";

export function PdfDialog(props: {
  title: string;
  subtitle?: string;
  /** blob: URL of the PDF, or null while it is being prepared. */
  url: string | null;
  failed?: boolean;
  /** Extra buttons next to "Close" (e.g. Save). */
  actions?: ComponentChildren;
  /**
   * Show the pages in the portal's own viewer, with these extra tools in its toolbar (e.g. a
   * rotate that does print). Used for print previews: the browser's viewer has a view-only
   * rotate and a print button that bypasses the portal's settings, and hides them only all
   * together with its whole toolbar.
   */
  pageViewer?: { tools?: ComponentChildren };
  onClose: () => void;
}) {
  const { t } = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      class="pp-dialog m-auto h-[min(90vh,60rem)] w-[min(94vw,56rem)] overflow-hidden rounded-2xl border border-rule bg-sheet p-0 text-ink shadow-2xl backdrop:bg-black/40"
      aria-labelledby="pdf-dialog-title"
      onClose={props.onClose}
    >
      <div class="flex h-full flex-col">
        <div class="flex flex-wrap items-center gap-2 border-b border-rule px-5 py-3">
          <div class="min-w-0 flex-1">
            <h2 id="pdf-dialog-title" class="m-0 truncate text-sm font-bold">
              {props.title}
            </h2>
            {props.subtitle && <p class="m-0 text-xs text-ink-soft">{props.subtitle}</p>}
            <p class="m-0 text-xs text-ink-faint">{t("preview.notShowing")}</p>
          </div>
          {props.actions}
          {props.url && (
            // Fallback for browsers that cannot show a PDF inside the page.
            <a href={props.url} target="_blank" rel="noopener" class="rounded-lg px-3 py-1.5 text-sm font-semibold text-accent-ink no-underline hover:bg-accent-wash">
              {t("preview.openInTab")}
            </a>
          )}
          <button type="button" class="cursor-pointer rounded-lg border border-rule bg-sheet px-3 py-1.5 text-sm font-semibold hover:bg-well" onClick={() => dialog.current?.close()}>
            {t("preview.close")}
          </button>
        </div>
        <div class="min-h-0 flex-1 bg-well">
          {props.url && props.pageViewer ? (
            <PageViewer url={props.url} title={props.title} tools={props.pageViewer.tools} />
          ) : props.url ? (
            <iframe src={props.url} title={props.title} class="h-full w-full border-0" />
          ) : (
            <p class={props.failed ? "m-6 text-sm font-medium text-error" : "m-6 text-sm text-ink-soft"}>{props.failed ? t("preview.failed") : t("preview.loading")}</p>
          )}
        </div>
      </div>
    </dialog>
  );
}
