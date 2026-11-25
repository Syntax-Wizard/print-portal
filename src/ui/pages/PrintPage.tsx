import { useEffect, useMemo, useState } from "preact/hooks";
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
import { useSubmissions } from "../useSubmissions";

function Summary({ o }: { o: PrintOptions }) {
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
    <p class="m-0 text-[15px] leading-relaxed text-ink">
      {sentence}
      {extra && <span class="block font-semibold">{extra}</span>}
    </p>
  );
}

export function PrintPage() {
  const { t } = useT();
  const { status } = usePrinter();
  const [options, setOptions] = useState<PrintOptions>(loadOptions);
  const [showErrors, setShowErrors] = useState(false);
  const { items, busy, tooMany, addFiles, remove, clearDone, print } = useSubmissions();

  useEffect(() => saveOptions(options), [options]);

  const errors = useMemo(() => validateOptions(options), [options]);
  const readyCount = items.filter((i) => i.status === "ready").length;
  const trays = status.data?.trays ?? [];

  const onPrint = () => {
    if (errors.length) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    void print(options);
  };

  const onRetry = (key: string) => {
    if (errors.length) {
      setShowErrors(true);
      return;
    }
    void print(options, key);
  };

  const buttonLabel = busy ? t("submit.busy") : readyCount > 0 ? t("submit.button", { count: readyCount }) : t("submit.buttonEmpty");
  const buttonClass = (enabled: boolean) =>
    cx("w-full rounded-xl px-5 py-3.5 text-base font-bold transition-colors", enabled ? "bg-accent text-on-accent hover:brightness-110" : "cursor-not-allowed bg-rule text-ink-faint");
  const canPrint = readyCount > 0 && !busy;

  return (
    <div class={cx("grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]", (readyCount > 0 || busy) && "pb-24 lg:pb-0")}>
      {(readyCount > 0 || busy) && (
        // On narrow screens the main button sits far below the settings; this bar keeps it in reach.
        <div class="fixed inset-x-0 bottom-0 z-10 border-t border-rule bg-sheet/95 px-4 py-3 backdrop-blur lg:hidden">
          <button type="button" class={buttonClass(canPrint)} disabled={!canPrint} onClick={onPrint}>
            {buttonLabel}
          </button>
        </div>
      )}
      <div class="flex min-w-0 flex-col gap-6">
        <DropZone onFiles={addFiles} compact={items.length > 0} />
        <FileList items={items} onRemove={remove} onRetry={onRetry} onClearDone={clearDone} tooMany={tooMany} />
        <section aria-labelledby="settings-heading" class="rounded-xl border border-rule bg-sheet p-5 sm:p-6">
          <h2 id="settings-heading" class="m-0 mb-5 text-base font-bold">
            {t("options.title")}
          </h2>
          <OptionsForm options={options} onChange={setOptions} trays={trays} errors={showErrors ? errors : []} />
        </section>
      </div>

      <aside class="flex flex-col gap-6 lg:sticky lg:top-6 lg:self-start">
        <section class="flex flex-col gap-4">
          <div class="mx-auto w-full max-w-64">
            <SheetPreview options={options} label={t("summary.previewLabel")} />
          </div>
          <Summary o={options} />
          <button type="button" class={buttonClass(canPrint)} disabled={!canPrint} onClick={onPrint}>
            {buttonLabel}
          </button>
          {readyCount === 0 && !busy && <p class="m-0 -mt-2 text-center text-sm text-ink-soft">{t("submit.noFiles")}</p>}
          {showErrors && errors.length > 0 && <p class="m-0 -mt-2 text-center text-sm text-error">{t("submit.fixErrors")}</p>}
        </section>

        {status.data && (
          <section class="flex flex-col gap-6 border-t border-rule pt-6">
            <div>
              <PanelHeading>{t("supplies.title")}</PanelHeading>
              <SupplyList supplies={status.data.supplies} kind="toner" />
            </div>
            <div>
              <PanelHeading>{t("trays.title")}</PanelHeading>
              <TrayList trays={trays} />
            </div>
            {status.updatedAt && <UpdatedAt at={status.updatedAt} onRefresh={status.refresh} />}
          </section>
        )}
        {status.error !== undefined && !status.data && <p class="m-0 text-sm text-error">{t("errors.statusUnavailable")}</p>}
      </aside>
    </div>
  );
}

export function UpdatedAt(props: { at: Date; onRefresh: () => void }) {
  const { t, lang } = useT();
  return (
    <p class="m-0 flex items-center gap-2 text-xs text-ink-faint">
      <span>{t("device.updatedAt", { time: formatTime(props.at, lang) })}</span>
      <button type="button" class="rounded px-1.5 py-0.5 text-accent-ink hover:bg-accent-wash" onClick={props.onRefresh}>
        {t("device.refresh")}
      </button>
    </p>
  );
}
