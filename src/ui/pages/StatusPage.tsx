import { useCallback, useState } from "preact/hooks";
import { formatDateTime, formatRelative, useT } from "../../i18n";
import { errorCategory } from "../errorCodes";
import { recognizeAlert } from "../alertText";
import { JobHistory } from "../components/jobs";
import { PanelHeading, SupplyList, TrayList, WasteToner, severityTextClass } from "../components/status";
import { usePrinter } from "../PrinterContext";
import { usePolling } from "../usePolling";
import { UpdatedAt } from "./PrintPage";

const ERROR_LOG_INTERVAL_MS = 5 * 60_000;
const ERROR_LOG_INITIAL = 5;
const ERROR_LOG_STEP = 10;

/** Job history, collapsed by default; it is only loaded (and polled) while expanded. */
function HistorySection(props: { initiallyOpen: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(props.initiallyOpen);
  return (
    <details class="card group p-5 sm:p-6 md:col-span-2" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary class="flex cursor-pointer list-none items-center gap-2 text-sm font-bold tracking-tight text-ink [&::-webkit-details-marker]:hidden">
        <span class="inline-block text-ink-faint transition-transform group-open:rotate-90" aria-hidden="true">
          ▸
        </span>
        {t("jobs.historyTitle")}
      </summary>
      {open && (
        <div class="mt-4">
          <JobHistory />
        </div>
      )}
    </details>
  );
}

/**
 * An alert from the published SNMP snapshot. The printer only words these in English; known
 * wordings are translated (original kept as a tooltip), others are shown with a translated category.
 */
function SnmpAlertText(props: { code: string; message: string }) {
  const { t, lang } = useT();
  // Colour names are capitalised as labels ("Yellow"); mid-sentence English wants "yellow".
  const colorName = (c: string) => (lang === "en" ? c.toLowerCase() : c);
  const known = recognizeAlert(props.message);
  if (known) {
    const text =
      known.key === "tonerReplaceSoon"
        ? t("alerts.known.tonerReplaceSoon", { color: colorName(t(`supplies.color.${known.color}`)) }) + (known.waitForInstruction ? ` ${t("alerts.known.waitForInstruction")}` : "")
        : t("alerts.known.partEndOfLife", { part: t(`alerts.parts.${known.part}`) });
    return (
      <span class="min-w-0 flex-1 text-ink" title={`${t("alerts.original")}: ${props.message}`}>
        {text}
      </span>
    );
  }
  return (
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="font-semibold text-ink">
        {t(`errorLog.category.${errorCategory(props.code)}`)}
      </span>
      <span class="text-xs text-ink-soft" lang="en">
        {props.message}
      </span>
    </span>
  );
}

export function StatusPage(props: { showHistory?: boolean } = {}) {
  const { t, lang } = useT();
  const { client, status } = usePrinter();
  const errorLog = usePolling(useCallback(() => client.getErrorLog(), [client]), ERROR_LOG_INTERVAL_MS);
  const [limit, setLimit] = useState(ERROR_LOG_INITIAL);
  const s = status.data;
  const snmpTime = s?.device.alerts.find((a) => a.measuredAt)?.measuredAt ?? null;

  if (!s) {
    return status.error !== undefined ? (
      <p class="card max-w-xl border-error/30 bg-error-wash/60 p-4 text-sm font-medium text-error">{t("errors.statusUnavailable")}</p>
    ) : null;
  }

  return (
    <div class="grid gap-6 md:grid-cols-2">
      <section class="card p-5 sm:p-6 md:col-span-2">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="m-0 text-sm font-bold tracking-tight text-ink">{t("alerts.title")}</h2>
          {s.device.alerts.length === 0 && (
            <span class="inline-flex items-center gap-1.5 rounded-full bg-ok-wash px-3 py-1 text-xs font-semibold text-ok">
              <span class="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden="true" />
              {t("alerts.none")}
            </span>
          )}
        </div>
        {s.device.alerts.length > 0 && (
          <ul class="m-0 mt-3.5 flex list-none flex-col gap-2.5 p-0">
            {s.device.alerts.map((a, i) => (
              <li key={i} class="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-rule bg-well/40 px-4 py-3 text-sm">
                <span class={`tabular rounded-md bg-sheet px-2 py-0.5 text-xs font-bold ring-1 ring-rule ${severityTextClass(a.severity)}`}>{a.code}</span>
                {a.measuredAt ? <SnmpAlertText code={a.code} message={a.message} /> : <span class="text-ink">{a.message}</span>}
              </li>
            ))}
          </ul>
        )}
        {snmpTime && <p class="m-0 mt-3 text-xs text-ink-faint">{t("alerts.snmpNote", { time: formatRelative(snmpTime, lang) })}</p>}
      </section>

      <section class="card flex flex-col justify-between p-5 sm:p-6">
        <div>
          <PanelHeading>{t("supplies.title")}</PanelHeading>
          <SupplyList supplies={s.supplies} kind="toner" showState />
        </div>
        <div class="mt-5 border-t border-rule/70 pt-4">
          <WasteToner supplies={s.supplies} />
        </div>
      </section>

      <section class="card p-5 sm:p-6">
        <PanelHeading>{t("supplies.drums")}</PanelHeading>
        <SupplyList supplies={s.supplies} kind="drum" showState />
      </section>

      <section class="card flex flex-col p-5 sm:p-6">
        <PanelHeading>{t("trays.title")}</PanelHeading>
        <TrayList trays={s.trays} />
      </section>

      <section class="card flex flex-col p-5 sm:p-6">
        <PanelHeading>{t("errorLog.title")}</PanelHeading>
        {errorLog.data && errorLog.data.length === 0 && <p class="m-0 rounded-xl bg-well/50 px-3.5 py-2.5 text-sm text-ink-soft">{t("errorLog.empty")}</p>}
        {errorLog.data && errorLog.data.length > 0 && (
          <div class="flex flex-1 flex-col justify-between gap-3">
            <div class="overflow-x-auto">
              <table class="w-full border-collapse text-sm">
                <tbody>
                  {errorLog.data.slice(0, limit).map((e, i) => (
                    <tr key={i} class="border-b border-rule/70 transition-colors last:border-0 hover:bg-well/40">
                      <td class="tabular whitespace-nowrap py-2 pr-3 text-xs text-ink-soft">{e.at ? formatDateTime(e.at, lang) : "—"}</td>
                      <td class="tabular whitespace-nowrap py-2 pr-3">
                        <span class="rounded-md bg-well px-2 py-0.5 text-xs font-semibold text-ink">{e.code}</span>
                      </td>
                      <td class="py-2 text-ink">{t(`errorLog.category.${errorCategory(e.code)}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {errorLog.data.length > limit && (
              <div>
                <button
                  type="button"
                  class="cursor-pointer rounded-xl border border-rule bg-sheet px-4 py-1.5 text-xs font-semibold text-ink shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition-colors hover:bg-well"
                  onClick={() => setLimit((l) => l + ERROR_LOG_STEP)}
                >
                  {t("jobs.showMore")}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <HistorySection initiallyOpen={Boolean(props.showHistory)} />

      {status.updatedAt && (
        <div class="px-1 md:col-span-2">
          <UpdatedAt at={status.updatedAt} onRefresh={status.refresh} />
        </div>
      )}
    </div>
  );
}
