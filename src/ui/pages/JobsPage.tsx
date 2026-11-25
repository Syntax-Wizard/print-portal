import { useCallback, useMemo, useState } from "preact/hooks";
import { formatDateTime, useT } from "../../i18n";
import type { HistoryJob, QueuedJob } from "../../printer/types";
import { isUnmapped } from "../../printer/types";
import { cx } from "../components/controls";
import { usePrinter } from "../PrinterContext";
import { usePolling } from "../usePolling";
import { UpdatedAt } from "./PrintPage";

const HISTORY_INTERVAL_MS = 30_000;
const PAGE_SIZE = 25;

function Owner({ owner, mine }: { owner: string; mine: boolean }) {
  const { t } = useT();
  if (mine) return <span class="inline-flex items-center rounded-full bg-accent-wash px-2.5 py-0.5 text-xs font-semibold text-accent-ink">{t("jobs.mine")}</span>;
  return <span class="text-ink-soft">{owner === "-" ? "—" : owner}</span>;
}

function QueueTable({ jobs, owner }: { jobs: QueuedJob[]; owner: string | null }) {
  const { t } = useT();
  if (jobs.length === 0) return <p class="m-0 rounded-xl bg-well/50 px-3.5 py-2.5 text-sm text-ink-soft">{t("jobs.queueEmpty")}</p>;
  return (
    <div class="overflow-x-auto">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="border-b border-rule text-left text-xs font-semibold text-ink-faint">
            <th class="pb-2.5 pr-4">{t("jobs.columns.owner")}</th>
            <th class="pb-2.5 pr-4">{t("jobs.columns.state")}</th>
            <th class="pb-2.5 pr-4">{t("jobs.columns.type")}</th>
            <th class="pb-2.5 text-right">{t("jobs.columns.copies")}</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} class="border-b border-rule/70 transition-colors last:border-0 hover:bg-well/40">
              <td class="py-3 pr-4">
                <Owner owner={j.owner} mine={owner !== null && j.owner === owner} />
              </td>
              <td class={cx("py-3 pr-4 font-semibold", j.state === "printing" ? "text-accent-ink" : "text-ink")}>
                {isUnmapped(j.state) ? j.state.raw : t(`jobs.state.${j.state}`)}
              </td>
              <td class="py-3 pr-4 text-ink-soft">{t(`jobs.type.${j.type}`)}</td>
              <td class="tabular py-3 text-right font-medium text-ink">{j.completedCopies ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function resultBadge(r: HistoryJob["result"]): string {
  if (r === "completed") return "bg-ok-wash text-ok";
  if (r === "warning") return "bg-warn-wash text-warn";
  if (r === "failed" || r === "aborted") return "bg-error-wash text-error";
  return "bg-well text-ink-soft";
}

export function JobsPage() {
  const { t, lang } = useT();
  const { client, queue, owner } = usePrinter();
  const history = usePolling(useCallback(() => client.getHistory(), [client]), HISTORY_INTERVAL_MS);
  const [onlyMine, setOnlyMine] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const rows = useMemo(() => {
    const all = history.data ?? [];
    return onlyMine && owner ? all.filter((h) => h.owner === owner) : all;
  }, [history.data, onlyMine, owner]);

  return (
    <div class="flex flex-col gap-6">
      <section aria-labelledby="queue-heading" class="card p-5 sm:p-6">
        <h2 id="queue-heading" class="m-0 mb-4 text-base font-bold tracking-tight text-ink">
          {t("jobs.queueTitle")}
        </h2>
        {queue.data ? <QueueTable jobs={queue.data} owner={owner} /> : queue.error !== undefined ? <p class="text-sm font-medium text-error">{t("errors.PRINTER_UNREACHABLE")}</p> : null}
        {queue.updatedAt && (
          <div class="mt-4 border-t border-rule/70 pt-3.5">
            <UpdatedAt at={queue.updatedAt} onRefresh={queue.refresh} />
          </div>
        )}
      </section>

      <section aria-labelledby="history-heading" class="card p-5 sm:p-6">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="history-heading" class="m-0 text-base font-bold tracking-tight text-ink">
            {t("jobs.historyTitle")}
          </h2>
          <label
            class={cx(
              "inline-flex select-none items-center gap-2 rounded-lg border border-rule bg-well/50 px-3 py-1.5 text-xs font-medium transition-colors",
              owner ? "cursor-pointer text-ink hover:bg-well" : "cursor-not-allowed text-ink-faint opacity-75",
            )}
          >
            <input
              type="checkbox"
              class="h-3.5 w-3.5 accent-accent"
              checked={onlyMine}
              disabled={!owner}
              onChange={(e) => setOnlyMine((e.currentTarget as HTMLInputElement).checked)}
            />
            {t("jobs.onlyMine")}
          </label>
        </div>
        {!owner && <p class="m-0 mb-4 rounded-xl bg-well/50 px-3.5 py-2.5 text-xs text-ink-soft">{t("jobs.mineUnknown")}</p>}
        {history.error !== undefined && !history.data && <p class="text-sm font-medium text-error">{t("errors.PRINTER_UNREACHABLE")}</p>}
        {history.data && rows.length === 0 && <p class="m-0 rounded-xl bg-well/50 px-3.5 py-2.5 text-sm text-ink-soft">{t("jobs.historyEmpty")}</p>}
        {rows.length > 0 && (
          <div class="overflow-x-auto">
            <table class="w-full border-collapse text-sm">
              <thead>
                <tr class="border-b border-rule text-left text-xs font-semibold text-ink-faint">
                  <th class="pb-2.5 pr-4">{t("jobs.columns.time")}</th>
                  <th class="pb-2.5 pr-4">{t("jobs.columns.owner")}</th>
                  <th class="pb-2.5 pr-4">{t("jobs.columns.type")}</th>
                  <th class="pb-2.5 pr-4">{t("jobs.columns.result")}</th>
                  <th class="pb-2.5 pr-4 text-right">{t("jobs.columns.pages")}</th>
                  <th class="pb-2.5">{t("jobs.columns.via")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((h, i) => (
                  <tr key={`${h.completedAt?.getTime()}-${i}`} class="border-b border-rule/70 transition-colors last:border-0 hover:bg-well/40">
                    <td class="tabular whitespace-nowrap py-3 pr-4 text-xs text-ink-soft">{h.completedAt ? formatDateTime(h.completedAt, lang) : "—"}</td>
                    <td class="py-3 pr-4">
                      <Owner owner={h.owner} mine={owner !== null && h.owner === owner} />
                    </td>
                    <td class="py-3 pr-4 text-ink">{t(`jobs.type.${h.type}`)}</td>
                    <td class="py-3 pr-4">
                      <span class={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", resultBadge(h.result))}>
                        {t(`jobs.result.${h.result}`)}
                      </span>
                    </td>
                    <td class="tabular py-3 pr-4 text-right font-medium text-ink">{h.pages ?? "—"}</td>
                    <td class="py-3 text-xs text-ink-soft">{h.hostInterface ? t(`jobs.via.${h.hostInterface}`, { defaultValue: h.hostInterface }) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > limit && (
              <button
                type="button"
                class="mt-4 cursor-pointer rounded-xl border border-rule bg-sheet px-4 py-2 text-xs font-semibold text-ink shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition-colors hover:bg-well"
                onClick={() => setLimit((l) => l + PAGE_SIZE)}
              >
                {t("jobs.showMore")}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
