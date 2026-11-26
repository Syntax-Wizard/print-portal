/**
 * The portal's own PDF page viewer, used for print previews instead of the browser's viewer:
 * that one cannot hide just its rotate button (only its whole toolbar), and the page cannot
 * see its rotation, so it could never act on printing. Here the toolbar has page navigation,
 * zoom, and whatever the caller adds (the print preview adds a rotate that does print).
 *
 * Pages are drawn with pdf.js (pdf-view.js, loaded on demand), only when near the visible
 * area. When the document changes (e.g. after rotating), the old pages stay on screen until
 * the new ones are ready, and the zoom and current page are kept.
 */

import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useT } from "../../i18n";
import type { ViewerDocument } from "../../pdfview/index";
import { loadPdfView } from "../../pdfview/loader";
import { cx } from "./controls";

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
/** Space around and between pages, in CSS pixels. */
const PAD = 24;
const GAP = 16;

interface Size {
  width: number;
  height: number;
}

function PageCanvas(props: { doc: ViewerDocument; page: number; width: number; height: number; root: HTMLElement | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const drawn = useRef<{ doc: ViewerDocument; width: number } | null>(null);

  useEffect(() => {
    const el = holder.current;
    if (!el || !props.root) return;
    const io = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), { root: props.root, rootMargin: "100% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [props.root]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !near) return;
    const last = drawn.current;
    if (last && last.doc === props.doc && Math.abs(last.width - props.width) < 1) return;
    drawn.current = { doc: props.doc, width: props.width };
    // A page of a document that was just replaced may fail to draw: the new one follows.
    props.doc.renderPage(props.page, c, props.width).catch(() => undefined);
  }, [near, props.doc, props.page, props.width]);

  return (
    <div ref={holder} data-page={props.page} class="mx-auto shrink-0 bg-white shadow-[0_1px_3px_rgb(15_23_42/0.18)]" style={{ width: `${props.width}px`, height: `${props.height}px` }}>
      <canvas ref={canvas} class="block h-full w-full" />
    </div>
  );
}

const toolButton =
  "grid h-8 min-w-8 cursor-pointer place-items-center rounded-lg px-2 text-sm font-semibold text-ink-soft transition-colors hover:bg-well hover:text-ink disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";

export function PageViewer(props: { url: string; title: string; tools?: ComponentChildren }) {
  const { t } = useT();
  const [doc, setDoc] = useState<ViewerDocument | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [current, setCurrent] = useState(1);
  const [boxWidth, setBoxWidth] = useState(0);
  const [boxHeight, setBoxHeight] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const docRef = useRef<ViewerDocument | null>(null);
  /** Page to bring back into view after the layout changes (zoom, new document). */
  const keepPage = useRef<number | null>(null);
  const currentRef = useRef(1);
  currentRef.current = current;

  // Load (or reload) the document; the previous one stays shown until this one is ready.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const bytes = new Uint8Array(await (await fetch(props.url)).arrayBuffer());
        const next = await (await loadPdfView()).openDocument(bytes);
        const s: Size[] = [];
        for (let i = 1; i <= next.pageCount; i++) s.push(await next.pageSize(i));
        if (cancelled) return void next.destroy();
        void docRef.current?.destroy();
        docRef.current = next;
        keepPage.current = Math.min(currentRef.current, next.pageCount);
        setSizes(s);
        setDoc(next);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.url]);
  useEffect(() => () => void docRef.current?.destroy(), []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setBoxWidth(el.clientWidth);
      setBoxHeight(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [failed]);

  // Zoom 1 shows a whole page (a print preview is about the whole sheet); zooming in goes from there.
  const maxPageWidth = Math.max(...sizes.map((s) => s.width), 1);
  const tallest = Math.max(...sizes.map((s) => (s.height / s.width) * (s.width / maxPageWidth)), 0.01);
  const fitWidth = Math.min(boxWidth - 2 * PAD, (boxHeight - 2 * PAD) / tallest);
  const pageWidth = Math.max(120, fitWidth * zoom);
  // Pages keep their relative sizes (an A3 page in an A4 document stays bigger).
  const widthOf = (s: Size) => (pageWidth * s.width) / maxPageWidth;

  useLayoutEffect(() => {
    const el = scroller.current;
    const page = keepPage.current;
    if (!el || page === null || !boxWidth) return;
    keepPage.current = null;
    const target = el.querySelector<HTMLElement>(`[data-page="${page}"]`);
    if (target) el.scrollTop = target.offsetTop - PAD;
  }, [zoom, sizes, boxWidth, boxHeight]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const probe = el.scrollTop + el.clientHeight / 3;
    let page = 1;
    for (const p of el.querySelectorAll<HTMLElement>("[data-page]")) if (p.offsetTop <= probe) page = Number(p.dataset.page);
    if (page !== currentRef.current) setCurrent(page);
  };

  const goTo = (page: number) => {
    const el = scroller.current;
    const target = el?.querySelector<HTMLElement>(`[data-page="${page}"]`);
    if (el && target) el.scrollTo({ top: target.offsetTop - PAD, behavior: "smooth" });
  };

  const zoomTo = (z: number) => {
    keepPage.current = currentRef.current;
    setZoom(z);
  };
  const zoomIndex = ZOOMS.indexOf(zoom);
  const onWheel = (e: WheelEvent) => {
    // Ctrl/⌘ + wheel, and pinch on a trackpad, zoom the pages rather than the whole page.
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const i = ZOOMS.indexOf(zoom);
    const next = e.deltaY < 0 ? ZOOMS[Math.min(ZOOMS.length - 1, i + 1)] : ZOOMS[Math.max(0, i - 1)];
    if (next !== undefined && next !== zoom) zoomTo(next);
  };

  if (failed) {
    // pdf.js could not be loaded: fall back to the browser's viewer, its toolbar hidden.
    return (
      <div class="flex h-full flex-col">
        {props.tools && <div class="flex items-center justify-end gap-1 border-b border-rule bg-sheet px-3 py-1.5">{props.tools}</div>}
        <iframe src={`${props.url}#toolbar=0`} title={props.title} class="w-full flex-1 border-0" />
      </div>
    );
  }

  const total = sizes.length;
  return (
    <div class="flex h-full flex-col">
      <div class="flex flex-wrap items-center gap-1 border-b border-rule bg-sheet px-3 py-1.5" role="toolbar" aria-label={t("preview.toolbar")}>
        <button type="button" class={toolButton} aria-label={t("preview.prevPage")} title={t("preview.prevPage")} disabled={current <= 1} onClick={() => goTo(current - 1)}>
          ‹
        </button>
        <span class="tabular min-w-14 text-center text-xs font-semibold text-ink-soft" aria-live="polite">
          {total ? t("preview.pageOf", { current, total }) : "…"}
        </span>
        <button type="button" class={toolButton} aria-label={t("preview.nextPage")} title={t("preview.nextPage")} disabled={current >= total} onClick={() => goTo(current + 1)}>
          ›
        </button>
        <span class="mx-1 h-5 w-px bg-rule" aria-hidden="true" />
        <button type="button" class={toolButton} aria-label={t("preview.zoomOut")} title={t("preview.zoomOut")} disabled={zoomIndex <= 0} onClick={() => zoomTo(ZOOMS[zoomIndex - 1]!)}>
          −
        </button>
        <button type="button" class={cx(toolButton, "tabular min-w-14 text-xs")} title={t("preview.zoomFit")} onClick={() => zoomTo(1)}>
          {zoom === 1 ? t("preview.fit") : `${Math.round(zoom * 100)}%`}
        </button>
        <button type="button" class={toolButton} aria-label={t("preview.zoomIn")} title={t("preview.zoomIn")} disabled={zoomIndex >= ZOOMS.length - 1} onClick={() => zoomTo(ZOOMS[zoomIndex + 1]!)}>
          +
        </button>
        {props.tools && (
          <>
            <span class="mx-1 h-5 w-px bg-rule" aria-hidden="true" />
            {props.tools}
          </>
        )}
      </div>
      <div
        ref={scroller}
        class="flex min-h-0 flex-1 flex-col overflow-auto bg-well outline-none"
        style={{ padding: `${PAD}px`, gap: `${GAP}px` }}
        tabIndex={0}
        aria-label={props.title}
        onScroll={onScroll}
        onWheel={onWheel}
      >
        {doc && boxWidth > 0
          ? sizes.map((s, i) => {
              const w = widthOf(s);
              return <PageCanvas key={i} doc={doc} page={i + 1} width={w} height={(w * s.height) / s.width} root={scroller.current} />;
            })
          : <p class="m-0 text-sm text-ink-soft">{t("preview.loading")}</p>}
      </div>
    </div>
  );
}
