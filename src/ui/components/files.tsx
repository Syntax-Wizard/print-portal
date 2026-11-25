/**
 * File intake: the drop zone and the list of files with their per-file progress.
 */

import { useRef, useState } from "preact/hooks";
import { useT } from "../../i18n";
import { ACCEPT, MAX_FILE_MB, MAX_FILES, formatSize } from "../files";
import type { PrintItem } from "../useSubmissions";
import { cx } from "./controls";

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

export function FileList(props: { items: PrintItem[]; onRemove: (key: string) => void; onRetry: (key: string) => void; onClearDone: () => void; tooMany: boolean }) {
  const { t, lang } = useT();
  if (props.items.length === 0 && !props.tooMany) return null;
  const anyDone = props.items.some((i) => i.status === "done");
  return (
    <div class="flex flex-col gap-2">
      <ul class="card m-0 flex list-none flex-col divide-y divide-rule overflow-hidden p-0" aria-live="polite">
        {props.items.map((item) => {
          const removable = ["ready", "failed", "done"].includes(item.status);
          return (
            <li key={item.key} class="relative flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-well/40">
              {item.status === "uploading" && (
                <span class="absolute inset-x-0 bottom-0 h-0.5 bg-accent transition-[width] duration-150" style={{ width: `${item.progress * 100}%` }} aria-hidden="true" />
              )}
              <FileGlyph name={item.file.name} invalid={Boolean(item.problem || item.status === "failed")} />
              <div class="min-w-0 flex-1">
                <p class="m-0 truncate text-sm font-semibold text-ink" title={item.file.name}>
                  {item.file.name}
                </p>
                <p class="m-0 mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                  <span class="tabular text-ink-faint">{formatSize(item.file.size, lang)}</span>
                  <span class="text-rule-strong" aria-hidden="true">
                    ·
                  </span>
                  <ItemStatusLine item={item} />
                </p>
              </div>
              {item.status === "failed" && !item.problem && (
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
        {anyDone && (
          <button type="button" class="cursor-pointer rounded-lg px-2.5 py-1 font-medium text-ink-soft transition-colors hover:bg-well hover:text-ink" onClick={props.onClearDone}>
            {t("files.clearDone")}
          </button>
        )}
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
