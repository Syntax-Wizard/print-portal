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
  if (mine) return <span class="rounded bg-accent-wash px-1.5 py-0.5 text-xs font-bold text-accent-ink">{t("jobs.mine")}</span>;
  return <span class="text-ink-soft">{owner === "-" ? "—" : owner}</span>;
}

function QueueTable({ jobs, owner }: { jobs: QueuedJob[]; owner: string | null }) {
  const { t } = useT();
  if (jobs.length === 0) return <p class="m-0 text-sm text-ink-soft">{t("jobs.queueEmpty")}</p>;
  return (
    <table class="w-full border-collapse text-sm">
      <thead>
        <tr class="border-b border-rule text-left text-ink-soft">
          <th class="py-2 pr-4 font-semibold">{t("jobs.columns.owner")}</th>
          <th class="py-2 pr-4 font-semibold">{t("jobs.columns.state")}</th>
          <th class="py-2 pr-4 font-semibold">{t("jobs.columns.type")}</th>
          <th class="py-2 text-right font-semibold">{t("jobs.columns.copies")}</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((j) => (
          <tr key={j.id} class="border-b border-rule last:border-0">
            <td class="py-2.5 pr-4">
              <Owner owner={j.owner} mine={owner !== null && j.owner === owner} />
            </td>
            <td class={cx("py-2.5 pr-4 font-semibold", j.state === "printing" && "text-accent-ink")}>{isUnmapped(j.state) ? j.state.raw : t(`jobs.state.${j.state}`)}</td>
            <td class="py-2.5 pr-4">{t(`jobs.type.${j.type}`)}</td>
            <td class="tabular py-2.5 text-right">{j.completedCopies ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function resultTone(r: HistoryJob["result"]): string {
  if (r === "completed") return "text-ink";
  if (r === "warning") return "text-warn";
  if (r === "failed" || r === "aborted") return "text-error";
  return "text-ink-soft";
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
    <div class="flex max-w-4xl flex-col gap-10">
      <section aria-labelledby="queue-heading">
        <h2 id="queue-heading" class="m-0 mb-3 text-lg font-bold">
          {t("jobs.queueTitle")}
        </h2>
        {queue.data ? <QueueTable jobs={queue.data} owner={owner} /> : queue.error !== undefined ? <p class="text-sm text-error">{t("errors.PRINTER_UNREACHABLE")}</p> : null}
        {queue.updatedAt && (
          <div class="mt-3">
            <UpdatedAt at={queue.updatedAt} onRefresh={queue.refresh} />
          </div>
        )}
      </section>

      <section aria-labelledby="history-heading">
        <div class="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="history-heading" class="m-0 text-lg font-bold">
            {t("jobs.historyTitle")}
          </h2>
          <label class={cx("flex items-center gap-2 text-sm", !owner && "text-ink-faint")}>
            <input type="checkbox" checked={onlyMine} disabled={!owner} onChange={(e) => setOnlyMine((e.currentTarget as HTMLInputElement).checked)} />
            {t("jobs.onlyMine")}
          </label>
        </div>
        {!owner && <p class="m-0 mb-3 text-sm text-ink-soft">{t("jobs.mineUnknown")}</p>}
        {history.error !== undefined && !history.data && <p class="text-sm text-error">{t("errors.PRINTER_UNREACHABLE")}</p>}
        {history.data && rows.length === 0 && <p class="text-sm text-ink-soft">{t("jobs.historyEmpty")}</p>}
        {rows.length > 0 && (
          <div class="overflow-x-auto">
            <table class="w-full border-collapse text-sm">
              <thead>
                <tr class="border-b border-rule text-left text-ink-soft">
                  <th class="py-2 pr-4 font-semibold">{t("jobs.columns.time")}</th>
                  <th class="py-2 pr-4 font-semibold">{t("jobs.columns.owner")}</th>
                  <th class="py-2 pr-4 font-semibold">{t("jobs.columns.type")}</th>
                  <th class="py-2 pr-4 font-semibold">{t("jobs.columns.result")}</th>
                  <th class="py-2 pr-4 text-right font-semibold">{t("jobs.columns.pages")}</th>
                  <th class="py-2 font-semibold">{t("jobs.columns.via")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((h, i) => (
                  <tr key={`${h.completedAt?.getTime()}-${i}`} class="border-b border-rule last:border-0">
                    <td class="tabular whitespace-nowrap py-2.5 pr-4">{h.completedAt ? formatDateTime(h.completedAt, lang) : "—"}</td>
                    <td class="py-2.5 pr-4">
                      <Owner owner={h.owner} mine={owner !== null && h.owner === owner} />
                    </td>
                    <td class="py-2.5 pr-4">{t(`jobs.type.${h.type}`)}</td>
                    <td class={cx("py-2.5 pr-4", resultTone(h.result))}>{t(`jobs.result.${h.result}`)}</td>
                    <td class="tabular py-2.5 pr-4 text-right">{h.pages ?? "—"}</td>
                    <td class="py-2.5 text-ink-soft">{h.hostInterface ? t(`jobs.via.${h.hostInterface}`, { defaultValue: h.hostInterface }) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > limit && (
              <button type="button" class="mt-3 rounded-lg border border-rule bg-sheet px-4 py-1.5 text-sm font-semibold hover:bg-paper" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                {t("jobs.showMore")}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
