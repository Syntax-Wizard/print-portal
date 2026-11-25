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
        "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-center transition-colors",
        props.compact ? "px-4 py-5" : "px-6 py-12",
        over ? "border-accent bg-accent-wash" : "border-rule bg-sheet",
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
      <p class={cx("m-0 font-bold", props.compact ? "text-base" : "text-lg")}>{over ? t("files.dropActive") : t("files.dropTitle")}</p>
      <button
        type="button"
        class="rounded-lg border border-ink bg-transparent px-4 py-1.5 text-sm font-semibold text-ink hover:bg-ink hover:text-paper"
        onClick={() => input.current?.click()}
      >
        {t("files.dropAction")}
      </button>
      {!props.compact && <p class="m-0 text-sm text-ink-soft">{t("files.dropHint", { max: MAX_FILE_MB })}</p>}
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
    return <span class="text-error">{text}</span>;
  }
  if (item.status === "failed" && item.error) {
    const e = item.error;
    return <span class="text-error">{t(`errors.${e.code}`, { fields: e.fields?.join(", ") ?? "", status: e.httpStatus ?? "" })}</span>;
  }
  const tone: Record<string, string> = {
    done: "text-ok",
    held: "text-warn",
    printing: "text-accent-ink",
    waiting: "text-accent-ink",
    sent: "text-accent-ink",
    uploading: "text-accent-ink",
  };
  return <span class={tone[item.status] ?? "text-ink-soft"}>{t(`item.${item.status}`, { percent: Math.round(item.progress * 100) })}</span>;
}

export function FileList(props: { items: PrintItem[]; onRemove: (key: string) => void; onRetry: (key: string) => void; onClearDone: () => void; tooMany: boolean }) {
  const { t, lang } = useT();
  if (props.items.length === 0 && !props.tooMany) return null;
  const anyDone = props.items.some((i) => i.status === "done");
  return (
    <div class="flex flex-col gap-2">
      <ul class="m-0 flex list-none flex-col divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-sheet p-0" aria-live="polite">
        {props.items.map((item) => {
          const removable = ["ready", "failed", "done"].includes(item.status);
          return (
            <li key={item.key} class="relative flex items-center gap-3 px-4 py-3">
              {item.status === "uploading" && (
                <span class="absolute inset-x-0 bottom-0 h-0.5 bg-accent transition-[width]" style={{ width: `${item.progress * 100}%` }} aria-hidden="true" />
              )}
              <FileGlyph name={item.file.name} />
              <div class="min-w-0 flex-1">
                <p class="m-0 truncate text-sm font-semibold" title={item.file.name}>
                  {item.file.name}
                </p>
                <p class="m-0 text-xs">
                  <span class="tabular text-ink-faint">{formatSize(item.file.size, lang)}</span>
                  <span class="text-ink-faint">　</span>
                  <ItemStatusLine item={item} />
                </p>
              </div>
              {item.status === "failed" && !item.problem && (
                <button type="button" class="rounded-md px-2 py-1 text-sm font-semibold text-accent-ink hover:bg-accent-wash" onClick={() => props.onRetry(item.key)}>
                  {t("item.retry")}
                </button>
              )}
              {removable && (
                <button
                  type="button"
                  class="grid h-8 w-8 place-items-center rounded-md text-lg text-ink-faint hover:bg-paper hover:text-ink"
                  aria-label={t("files.remove", { name: item.file.name })}
                  onClick={() => props.onRemove(item.key)}
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
        {props.tooMany ? <p class="m-0 text-warn">{t("files.tooMany", { max: MAX_FILES })}</p> : <span />}
        {anyDone && (
          <button type="button" class="rounded-md px-2 py-1 text-ink-soft hover:bg-sheet hover:text-ink" onClick={props.onClearDone}>
            {t("files.clearDone")}
          </button>
        )}
      </div>
    </div>
  );
}

function FileGlyph({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toUpperCase().slice(0, 4) ?? "";
  return (
    <span class="grid h-10 w-8 shrink-0 place-items-end rounded-sm border border-rule bg-paper pb-1 text-[9px] font-bold text-ink-soft" aria-hidden="true">
      <span class="w-full text-center">{ext}</span>
    </span>
  );
}
