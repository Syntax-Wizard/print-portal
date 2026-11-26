/**
 * File intake: the drop zone and the list of files with their per-file progress.
 */

import { checkRange, isImageItem, isPdf } from "../pdfJobs";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { useT } from "../../i18n";
import { ACCEPT, MAX_FILE_MB, MAX_FILES, formatSize } from "../files";
import { type PrintItem, isCancellable } from "../useSubmissions";
import { cx, prefersReducedMotion } from "./controls";

export function DropZone(props: { onFiles: (files: File[]) => void; compact?: boolean }) {
  const { t } = useT();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  return (
    <div
      class={cx(
        "group relative flex rounded-2xl border-2 border-dashed transition-all duration-150",
        props.compact
          ? "flex-wrap items-center justify-between gap-3 px-5 py-4 text-left"
          : "flex-col items-center justify-center gap-3 px-6 py-11 text-center",
        over
          ? "scale-[1.005] border-accent bg-accent-wash/60 shadow-[0_0_0_4px_rgb(2_132_199/0.12)]"
          : "border-rule-strong bg-sheet shadow-[0_1px_2px_rgb(15_23_42/0.03)] hover:border-accent/60 hover:bg-accent-wash/20",
      )}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const files = [...(e.dataTransfer?.files ?? [])];
        if (files.length) props.onFiles(files);
      }}
    >
      <div class={cx("flex items-center gap-3", !props.compact && "flex-col")}>
        <div
          class={cx(
            "grid place-items-center rounded-xl transition-colors",
            props.compact ? "h-10 w-10 shrink-0" : "h-12 w-12",
            over ? "bg-accent text-on-accent" : "bg-accent-wash text-accent-ink group-hover:bg-accent group-hover:text-on-accent",
          )}
          aria-hidden="true"
        >
          <svg class={props.compact ? "h-5 w-5" : "h-6 w-6"} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 16V4m0 0-4 4m4-4 4 4" />
            <path d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
          </svg>
        </div>
        <div class={cx("min-w-0", !props.compact && "flex flex-col items-center gap-1")}>
          <p class={cx("m-0 font-bold tracking-tight text-ink", props.compact ? "text-sm sm:text-[15px]" : "text-base sm:text-lg")}>
            {over ? t("files.dropActive") : t("files.dropTitle")}
          </p>
          {!props.compact && <p class="m-0 text-xs text-ink-soft sm:text-sm">{t("files.dropHint", { max: MAX_FILE_MB })}</p>}
        </div>
      </div>

      <button
        type="button"
        class={cx(
          "cursor-pointer rounded-xl border border-rule-strong bg-sheet px-4 py-2 text-sm font-semibold text-ink shadow-[0_1px_2px_rgb(15_23_42/0.05)] transition-all hover:border-accent/60 hover:bg-well active:scale-[0.98]",
          !props.compact && "mt-1",
        )}
        onClick={() => input.current?.click()}
      >
        {t("files.dropAction")}
      </button>

      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        class="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const el = e.currentTarget as HTMLInputElement;
          if (el.files?.length) props.onFiles([...el.files]);
          el.value = "";
        }}
      />
    </div>
  );
}

function ItemStatusLine({ item }: { item: PrintItem }) {
  const { t } = useT();
  if (item.problem) {
    const text = t(`files.${item.problem}`, { max: MAX_FILE_MB });
    return <span class="font-medium text-error">{text}</span>;
  }
  if (item.status === "failed" && item.error) {
    const e = item.error;
    return <span class="font-medium text-error">{t(`errors.${e.code}`, { fields: e.fields?.join(", ") ?? "", status: e.httpStatus ?? "" })}</span>;
  }
  if (item.status === "done") {
    // A small check that pops in when the printer finishes: the moment worth noticing.
    return (
      <span class="inline-flex items-center gap-1 font-medium text-ok">
        <svg class="pp-pop h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
        </svg>
        {t("item.done")}
      </span>
    );
  }
  const tone: Record<string, string> = {
    done: "font-medium text-ok",
    held: "font-medium text-warn",
    printing: "font-medium text-accent-ink",
    waiting: "font-medium text-accent-ink",
    sent: "font-medium text-accent-ink",
    uploading: "font-medium text-accent-ink",
  };
  return <span class={tone[item.status] ?? "text-ink-soft"}>{t(`item.${item.status}`, { percent: Math.round(item.progress * 100) })}</span>;
}

/** Rotate the whole file a further 90° clockwise; shows the current angle. */
function RotateButton(props: { item: PrintItem; onRotate: () => void }) {
  const { t } = useT();
  const angle = props.item.rotation;
  return (
    <button
      type="button"
      class={cx(
        "inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-colors hover:bg-accent-wash",
        angle ? "bg-accent-wash/60 text-accent-ink" : "text-accent-ink",
      )}
      aria-label={t("files.rotateLabel", { name: props.item.file.name, angle })}
      onClick={props.onRotate}
    >
      <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M13 8a5 5 0 1 1-1.5-3.6" />
        <path d="M13 2.5V5h-2.5" />
      </svg>
      {t("files.rotate")}
      {angle ? <span class="tabular">{angle}°</span> : null}
    </button>
  );
}

function PdfControls(props: { item: PrintItem; onRangeChange: (text: string) => void; onPreview: () => void; onRotate: () => void }) {
  const { t } = useT();
  const { item } = props;
  const id = `range-${item.key}`;
  const range = checkRange(item);
  const editable = item.status === "ready" || item.status === "failed";
  if (item.pdfIssue) return <p class="m-0 mt-1.5 text-xs font-medium text-warn">{t(`files.pdfIssue.${item.pdfIssue}`)}</p>;
  if (!editable || item.pageCount === null) return null;
  if (isImageItem(item)) {
    // Images are a single page: only the preview of the converted page makes sense.
    return (
      <div class="mt-1.5 flex flex-wrap items-center gap-1">
        <RotateButton item={item} onRotate={props.onRotate} />
        <button type="button" class="cursor-pointer rounded-lg px-2 py-1 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent-wash" onClick={props.onPreview}>
          {t("files.preview")}
        </button>
      </div>
    );
  }
  const rangeError = range && !range.ok ? (range.error === "outOfRange" ? t("files.rangeOutOfRange", { count: item.pageCount }) : t("files.rangeInvalid")) : null;
  return (
    <div class="mt-2 flex flex-col gap-1">
      <div class="flex flex-wrap items-center gap-2">
        <label class="text-xs font-semibold text-ink-soft" for={id}>
          {t("files.pageRange")}
        </label>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          class={cx("w-40 rounded-lg border bg-sheet px-2.5 py-1 text-xs text-ink", rangeError ? "border-error" : "border-rule")}
          placeholder={t("files.pageRangePlaceholder")}
          value={item.pageRange}
          aria-invalid={rangeError ? true : undefined}
          aria-describedby={rangeError ? `${id}-error` : undefined}
          onInput={(e) => props.onRangeChange((e.currentTarget as HTMLInputElement).value)}
        />
        <RotateButton item={item} onRotate={props.onRotate} />
        <button type="button" class="cursor-pointer rounded-lg px-2 py-1 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent-wash disabled:cursor-not-allowed disabled:text-ink-faint" disabled={Boolean(rangeError)} onClick={props.onPreview}>
          {t("files.preview")}
        </button>
      </div>
      {rangeError && (
        <p id={`${id}-error`} class="m-0 text-xs font-medium text-error">
          {rangeError}
        </p>
      )}
    </div>
  );
}

type Place = "before" | "after";

interface Slot {
  el: HTMLElement;
  key: string;
  top: number;
  height: number;
}

interface DragSession {
  key: string;
  el: HTMLElement;
  startY: number;
  dy: number;
  slots: Slot[];
  index: number;
  /** Current shift of each other row: +height (moved down), -height (moved up) or 0. */
  shifts: Map<string, number>;
  frame: number;
}

/**
 * Reorder rows by dragging their handle (mouse, pen or touch), or with ↑/↓ on a focused handle.
 *
 * Smoothness comes from not touching app state while dragging: the dragged row and the rows it
 * passes are moved with CSS transforms only (the others slide via their transform transition),
 * once per animation frame. On release the row settles into its slot, then the new order is
 * committed in one update and the transforms are dropped in the same frame, so nothing jumps.
 */
function useDragReorder(onMove?: (key: string, delta: -1 | 1) => void, onReorder?: (key: string, target: string, place: Place) => void) {
  const listRef = useRef<HTMLUListElement>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const session = useRef<DragSession | null>(null);
  const settling = useRef(false);
  const committing = useRef(false);
  const refocus = useRef<string | null>(null);
  const positions = useRef(new Map<string, number>());

  const rowOf = (key: string) => listRef.current?.querySelector<HTMLElement>(`:scope > li[data-key="${CSS.escape(key)}"]`) ?? null;

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const rows = [...list.querySelectorAll<HTMLElement>(":scope > li[data-key]")];
    if (committing.current) {
      // The dropped order is now in the DOM, where the transforms already showed it: drop them
      // without a transition, before the browser paints.
      committing.current = false;
      for (const row of rows) {
        row.style.transition = "none";
        row.style.transform = "";
      }
      void list.offsetHeight;
      for (const row of rows) row.style.transition = "";
    } else if (!session.current && !settling.current && !prefersReducedMotion()) {
      // Other reorders (keyboard, a file removed): slide rows from where they were (FLIP).
      for (const row of rows) {
        const before = positions.current.get(row.dataset.key!);
        const delta = before === undefined ? 0 : before - row.offsetTop;
        if (!delta) continue;
        row.style.transition = "none";
        row.style.transform = `translateY(${delta}px)`;
        void row.offsetHeight;
        row.style.transition = "transform var(--pp-dur-enter) var(--pp-ease-move)";
        row.style.transform = "";
      }
    }
    if (!session.current) positions.current = new Map(rows.map((r) => [r.dataset.key!, r.offsetTop]));
    if (refocus.current) {
      rowOf(refocus.current)?.querySelector<HTMLElement>("[data-drag-handle]")?.focus();
      refocus.current = null;
    }
  });

  /** Apply the latest pointer position: move the dragged row, shift the rows it has passed. */
  const paint = (s: DragSession) => {
    const me = s.slots[s.index]!;
    const first = s.slots[0]!;
    const last = s.slots[s.slots.length - 1]!;
    const dy = Math.max(first.top - me.top, Math.min(last.top + last.height - me.top - me.height, s.dy));
    s.el.style.transform = `translateY(${dy}px)`;
    const center = me.top + dy + me.height / 2;
    s.slots.forEach((slot, i) => {
      if (i === s.index) return;
      const mid = slot.top + slot.height / 2;
      const shift = i < s.index && center < mid ? me.height : i > s.index && center > mid ? -me.height : 0;
      if ((s.shifts.get(slot.key) ?? 0) === shift) return;
      s.shifts.set(slot.key, shift);
      slot.el.style.transition = "transform var(--pp-dur-enter) var(--pp-ease-move)";
      slot.el.style.transform = shift ? `translateY(${shift}px)` : "";
    });
  };

  const drop = () => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    cancelAnimationFrame(s.frame);
    paint(s);
    const movedDown = s.slots.filter((x) => (s.shifts.get(x.key) ?? 0) > 0); // rows above, now below
    const movedUp = s.slots.filter((x) => (s.shifts.get(x.key) ?? 0) < 0); // rows below, now above
    const target = movedUp.reduce((h, x) => h + x.height, 0) - movedDown.reduce((h, x) => h + x.height, 0);
    settling.current = true;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      settling.current = false;
      committing.current = true;
      if (movedDown.length) onReorder?.(s.key, movedDown[0]!.key, "before");
      else if (movedUp.length) onReorder?.(s.key, movedUp[movedUp.length - 1]!.key, "after");
      setDragKey(null);
    };
    // Settle into the gap, then commit.
    s.el.style.transition = "transform var(--pp-dur-enter) var(--pp-ease-move)";
    s.el.style.transform = `translateY(${target}px)`;
    s.el.addEventListener("transitionend", finish, { once: true });
    window.setTimeout(finish, 400);
  };

  const handleProps = (key: string) => ({
    "data-drag-handle": true,
    onPointerDown: (e: PointerEvent) => {
      const list = listRef.current;
      const row = rowOf(key);
      if (!onReorder || !list || !row || e.button !== 0 || session.current || settling.current) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const slots = [...list.querySelectorAll<HTMLElement>(":scope > li[data-draggable]")].map((el) => ({
        el,
        key: el.dataset.key!,
        top: el.offsetTop,
        height: el.offsetHeight,
      }));
      const index = slots.findIndex((x) => x.key === key);
      if (index < 0) return;
      row.style.transition = "none";
      session.current = { key, el: row, startY: e.clientY, dy: 0, slots, index, shifts: new Map(), frame: 0 };
      setDragKey(key);
    },
    onPointerMove: (e: PointerEvent) => {
      const s = session.current;
      if (!s) return;
      s.dy = e.clientY - s.startY;
      if (!s.frame) {
        s.frame = requestAnimationFrame(() => {
          s.frame = 0;
          if (session.current === s) paint(s);
        });
      }
    },
    onPointerUp: drop,
    onPointerCancel: drop,
    onKeyDown: (e: KeyboardEvent) => {
      const delta = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
      const row = rowOf(key);
      if (!delta || !row || !onMove) return;
      e.preventDefault();
      const next = (delta < 0 ? row.previousElementSibling : row.nextElementSibling) as HTMLElement | null;
      if (!next?.dataset.draggable) return;
      refocus.current = key; // the row's DOM node moves, which can drop focus
      onMove(key, delta);
    },
  });

  return { listRef, dragKey, handleProps };
}

/** Drag handle: grip dots between two small triangles (it moves rows up and down). */
function DragHandle(props: { name: string; dragging: boolean; handle: ReturnType<ReturnType<typeof useDragReorder>["handleProps"]> }) {
  const { t } = useT();
  return (
    <button
      type="button"
      {...props.handle}
      class={cx(
        "-ml-1.5 grid h-11 w-5 shrink-0 touch-none select-none place-items-center rounded-md transition-colors",
        props.dragging ? "cursor-grabbing bg-well text-ink-soft" : "cursor-grab text-ink-faint hover:bg-well hover:text-ink-soft",
      )}
      aria-label={t("files.reorderLabel", { name: props.name })}
      title={t("files.reorderHint")}
    >
      <svg class="h-6 w-2.5" viewBox="0 0 10 24" fill="currentColor" aria-hidden="true">
        <path d="M5 0.5 8.5 4.5h-7Z" />
        <circle cx="2.8" cy="8.5" r="1.15" />
        <circle cx="7.2" cy="8.5" r="1.15" />
        <circle cx="2.8" cy="12" r="1.15" />
        <circle cx="7.2" cy="12" r="1.15" />
        <circle cx="2.8" cy="15.5" r="1.15" />
        <circle cx="7.2" cy="15.5" r="1.15" />
        <path d="M5 23.5 8.5 19.5h-7Z" />
      </svg>
    </button>
  );
}

export function FileList(props: {
  items: PrintItem[];
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
  onClearDone: () => void;
  onRangeChange: (key: string, text: string) => void;
  onPreview: (key: string) => void;
  /** Reorders files waiting to print (they print, or are merged, in list order). */
  onMove?: (key: string, delta: -1 | 1) => void;
  /** Drop a dragged file before or after another. */
  onReorder?: (key: string, target: string, place: "before" | "after") => void;
  onRotate: (key: string) => void;
  onCancel?: (key: string) => void;
  onCancelAll?: () => void;
  tooMany: boolean;
}) {
  const { t, lang } = useT();
  const { listRef, dragKey, handleProps } = useDragReorder(props.onMove, props.onReorder);
  if (props.items.length === 0 && !props.tooMany) return null;
  const isDraggable = (i: PrintItem) => Boolean(props.onMove && props.onReorder) && i.status === "ready" && !i.problem;
  const reorderable = props.items.filter(isDraggable).length > 1;
  const anyDone = props.items.some((i) => i.status === "done");
  const cancellableCount = props.items.filter(isCancellable).length;
  return (
    <div class="flex flex-col gap-2">
      <ul ref={listRef} class="card m-0 flex list-none flex-col divide-y divide-rule overflow-hidden p-0" aria-live="polite">
        {props.items.map((item) => {
          const removable = ["ready", "failed", "done", "canceled"].includes(item.status);
          const cancellable = isCancellable(item);
          return (
            <li
              key={item.key}
              data-key={item.key}
              data-draggable={reorderable && isDraggable(item) ? "true" : undefined}
              class={cx(
                "pp-enter relative flex items-center gap-3.5 px-4 py-3.5",
                // While dragged: opaque and lifted (no translucent hover tint, or the row below shows through).
                dragKey === item.key
                  ? "z-10 bg-sheet shadow-[0_8px_24px_-6px_rgb(15_23_42/0.25)] ring-1 ring-accent/30"
                  : "transition-[background-color,transform] duration-(--pp-dur-enter) ease-(--pp-ease-move) hover:bg-well/40",
              )}
            >
              {item.status === "uploading" && (
                <span class="absolute inset-x-0 bottom-0 h-0.5 bg-accent transition-[width] duration-150" style={{ width: `${item.progress * 100}%` }} aria-hidden="true" />
              )}
              {reorderable &&
                (isDraggable(item) ? (
                  <DragHandle name={item.file.name} dragging={dragKey === item.key} handle={handleProps(item.key)} />
                ) : (
                  <span class="-ml-1.5 w-5 shrink-0" aria-hidden="true" />
                ))}
              <FileGlyph name={item.file.name} invalid={Boolean(item.problem || item.status === "failed")} />
              <div class="min-w-0 flex-1">
                <p class="m-0 truncate text-sm font-semibold text-ink" title={item.file.name}>
                  {item.file.name}
                </p>
                <p class="m-0 mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                  <span class="tabular text-ink-faint">{formatSize(item.file.size, lang)}</span>
                  {isPdf(item.file) && !item.problem && !item.pdfIssue && (
                    <span class="tabular text-ink-faint">{item.pageCount !== null ? t("files.pages", { count: item.pageCount }) : t("files.countingPages")}</span>
                  )}
                  <span class="text-rule-strong" aria-hidden="true">
                    ·
                  </span>
                  <ItemStatusLine item={item} />
                </p>
                {(isPdf(item.file) || isImageItem(item)) && !item.problem && (
                  <PdfControls item={item} onRangeChange={(text) => props.onRangeChange(item.key, text)} onPreview={() => props.onPreview(item.key)} onRotate={() => props.onRotate(item.key)} />
                )}
              </div>
              {cancellable && props.onCancel && (
                <button
                  type="button"
                  class="cursor-pointer rounded-lg border border-rule bg-sheet px-2.5 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-error/40 hover:bg-error-wash hover:text-error"
                  aria-label={t("files.cancelLabel", { name: item.file.name })}
                  onClick={() => props.onCancel!(item.key)}
                >
                  {t("files.cancel")}
                </button>
              )}
              {(item.status === "failed" || item.status === "canceled") && !item.problem && (
                <button
                  type="button"
                  class="cursor-pointer rounded-lg bg-accent-wash px-2.5 py-1.5 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent hover:text-on-accent"
                  onClick={() => props.onRetry(item.key)}
                >
                  {t("item.retry")}
                </button>
              )}
              {removable && (
                <button
                  type="button"
                  class="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-faint transition-colors hover:bg-well hover:text-ink"
                  aria-label={t("files.remove", { name: item.file.name })}
                  onClick={() => props.onRemove(item.key)}
                >
                  <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
                  </svg>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div class="flex flex-wrap items-center justify-between gap-2 px-1 text-xs">
        {props.tooMany ? <p class="m-0 font-medium text-warn">{t("files.tooMany", { max: MAX_FILES })}</p> : <span />}
        <span class="flex flex-wrap items-center gap-1">
        {cancellableCount > 1 && props.onCancelAll && (
          <button
            type="button"
            class="cursor-pointer rounded-lg px-2.5 py-1 font-semibold text-ink-soft transition-colors hover:bg-error-wash hover:text-error"
            onClick={props.onCancelAll}
          >
            {t("files.cancelAll", { count: cancellableCount })}
          </button>
        )}
        {anyDone && (
          <button type="button" class="cursor-pointer rounded-lg px-2.5 py-1 font-medium text-ink-soft transition-colors hover:bg-well hover:text-ink" onClick={props.onClearDone}>
            {t("files.clearDone")}
          </button>
        )}
        </span>
      </div>
    </div>
  );
}

function FileGlyph({ name, invalid }: { name: string; invalid?: boolean }) {
  const ext = name.split(".").pop()?.toUpperCase().slice(0, 4) ?? "";
  const badgeClass = invalid
    ? "border-error/30 bg-error-wash text-error"
    : ext === "PDF"
      ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300"
      : ext === "JPG" || ext === "JPEG"
        ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/50 dark:text-sky-300"
        : "border-rule bg-well text-ink-soft";
  return (
    <span class={cx("grid h-10 w-9 shrink-0 place-items-center rounded-lg border text-[10px] font-bold tracking-tight", badgeClass)} aria-hidden="true">
      {ext || "FILE"}
    </span>
  );
}
