import { useCallback, useState } from "preact/hooks";
import { formatDateTime, useT } from "../../i18n";
import { errorCategory } from "../errorCodes";
import { PanelHeading, SupplyList, TrayList, WasteToner, severityTextClass } from "../components/status";
import { usePrinter } from "../PrinterContext";
import { usePolling } from "../usePolling";
import { UpdatedAt } from "./PrintPage";

const ERROR_LOG_INTERVAL_MS = 5 * 60_000;
const ERROR_LOG_PAGE = 15;

export function StatusPage() {
  const { t, lang } = useT();
  const { client, status } = usePrinter();
  const errorLog = usePolling(useCallback(() => client.getErrorLog(), [client]), ERROR_LOG_INTERVAL_MS);
  const [limit, setLimit] = useState(ERROR_LOG_PAGE);
  const s = status.data;

  if (!s) {
    return status.error !== undefined ? <p class="text-sm text-error">{t("errors.statusUnavailable")}</p> : null;
  }

  return (
    <div class="grid max-w-5xl gap-x-12 gap-y-10 md:grid-cols-2">
      <section class="md:col-span-2">
        <PanelHeading>{t("alerts.title")}</PanelHeading>
        {s.device.alerts.length === 0 ? (
          <p class="m-0 text-sm text-ink-soft">{t("alerts.none")}</p>
        ) : (
          <ul class="m-0 flex list-none flex-col gap-2 p-0">
            {s.device.alerts.map((a, i) => (
              <li key={i} class="rounded-lg border border-rule bg-sheet px-4 py-3 text-sm">
                <span class={`tabular mr-3 font-bold ${severityTextClass(a.severity)}`}>{a.code}</span>
                {a.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <PanelHeading>{t("supplies.title")}</PanelHeading>
        <SupplyList supplies={s.supplies} kind="toner" showState />
        <div class="mt-5">
          <WasteToner supplies={s.supplies} />
        </div>
      </section>

      <section>
        <PanelHeading>{t("supplies.drums")}</PanelHeading>
        <SupplyList supplies={s.supplies} kind="drum" showState />
      </section>

      <section>
        <PanelHeading>{t("trays.title")}</PanelHeading>
        <TrayList trays={s.trays} />
      </section>

      <section>
        <PanelHeading>{t("errorLog.title")}</PanelHeading>
        {errorLog.data && errorLog.data.length === 0 && <p class="m-0 text-sm text-ink-soft">{t("errorLog.empty")}</p>}
        {errorLog.data && errorLog.data.length > 0 && (
          <>
            <table class="w-full border-collapse text-sm">
              <tbody>
                {errorLog.data.slice(0, limit).map((e, i) => (
                  <tr key={i} class="border-b border-rule last:border-0">
                    <td class="tabular whitespace-nowrap py-2 pr-4 text-ink-soft">{e.at ? formatDateTime(e.at, lang) : "—"}</td>
                    <td class="tabular whitespace-nowrap py-2 pr-4 font-semibold">{e.code}</td>
                    <td class="py-2">{t(`errorLog.category.${errorCategory(e.code)}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {errorLog.data.length > limit && (
              <button type="button" class="mt-3 rounded-lg border border-rule bg-sheet px-4 py-1.5 text-sm font-semibold hover:bg-paper" onClick={() => setLimit((l) => l + ERROR_LOG_PAGE)}>
                {t("jobs.showMore")}
              </button>
            )}
          </>
        )}
      </section>

      {status.updatedAt && (
        <div class="md:col-span-2">
          <UpdatedAt at={status.updatedAt} onRefresh={status.refresh} />
        </div>
      )}
    </div>
  );
}
