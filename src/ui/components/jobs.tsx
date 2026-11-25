/**
 * Print jobs. The current queue appears on the print page only while something is queued;
 * the history lives in a collapsed section of the status page. Neither needs its own tab.
 */

import { useCallback, useMemo, useState } from "preact/hooks";
import { formatDateTime, useT } from "../../i18n";
import type { HistoryJob, QueuedJob } from "../../printer/types";
import { isUnmapped } from "../../printer/types";
import { cx } from "./controls";
import { usePrinter } from "../PrinterContext";
import { usePrintList } from "../useSubmissions";
import { usePolling } from "../usePolling";

const HISTORY_INTERVAL_MS = 30_000;
const PAGE_SIZE = 25;

function Owner({ owner, mine }: { owner: string; mine: boolean }) {
  const { t } = useT();
  if (mine) return <span class="inline-flex items-center rounded-full bg-accent-wash px-2.5 py-0.5 text-xs font-semibold text-accent-ink">{t("jobs.mine")}</span>;
  return <span class="text-ink-soft">{owner === "-" ? "—" : owner}</span>;
}

/** Jobs at the printer right now, for the print page. Renders nothing when the queue is empty. */
export function QueuePanel() {
  const { t } = useT();
  const { queue, owner } = usePrinter();
  const { cancelJob } = usePrintList();
  // The printer logs every mailbox retrieval (thumbnails, downloads) as a job: not of interest here.
  const jobs = (queue.data ?? []).filter((j) => j.type !== "mailboxRetrieval");
  if (jobs.length === 0) return null;
  return (
    <section class="card flex flex-col gap-3 p-5" aria-labelledby="queue-heading">
      <h2 id="queue-heading" class="m-0 text-sm font-bold tracking-tight text-ink">
        {t("jobs.queueTitle")}
      </h2>
      <ul class="m-0 flex list-none flex-col gap-2 p-0" aria-live="polite">
        {jobs.map((j: QueuedJob) => {
          const mine = owner !== null && j.owner === owner;
          // The printer cancels any job for anyone; only offer it for the user's own,
          // and only in the states the printer accepts (waiting, printing).
          const cancellable = mine && (j.state === "waiting" || j.state === "printing");
          return (
            <li key={j.id} class="flex items-center justify-between gap-3 text-sm">
              <Owner owner={j.owner} mine={mine} />
              <span class="flex items-center gap-2">
                <span class={cx("font-semibold", j.state === "printing" ? "text-accent-ink" : "text-ink-soft")}>
                  {isUnmapped(j.state) ? j.state.raw : t(`jobs.state.${j.state}`)}
                </span>
                {cancellable && (
                  <button
                    type="button"
                    class="cursor-pointer rounded-md border border-rule bg-sheet px-2 py-0.5 text-xs font-semibold text-ink-soft hover:border-error/40 hover:bg-error-wash hover:text-error"
                    onClick={async () => {
                      if (!window.confirm(t("jobs.cancelConfirm"))) return;
                      const result = await cancelJob(j.id);
                      if (!result.ok) window.alert(t("files.cancelFailed"));
                    }}
                  >
                    {t("files.cancel")}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function resultBadge(r: HistoryJob["result"]): string {
  if (r === "completed") return "bg-ok-wash text-ok";
  if (r === "warning") return "bg-warn-wash text-warn";
  if (r === "failed" || r === "aborted") return "bg-error-wash text-error";
  return "bg-well text-ink-soft";
}

/** Recent jobs; polled only while mounted (i.e. while its section is expanded). */
export function JobHistory() {
  const { t, lang } = useT();
  const { client, owner } = usePrinter();
  const history = usePolling(useCallback(() => client.getHistory(), [client]), HISTORY_INTERVAL_MS);
  const [onlyMine, setOnlyMine] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const rows = useMemo(() => {
    // Mailbox retrievals ("ボックス取出") cannot be avoided on the printer, so they are hidden here.
    const all = (history.data ?? []).filter((h) => h.type !== "mailboxRetrieval");
    return onlyMine && owner ? all.filter((h) => h.owner === owner) : all;
  }, [history.data, onlyMine, owner]);

  return (
    <div>
      <section>
        <div class="mb-4 flex flex-wrap items-center justify-end gap-3">
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
            {(rows.length > limit || limit > PAGE_SIZE) && (
              <div class="mt-4 flex flex-wrap gap-2">
                {rows.length > limit && (
                  <button
                    type="button"
                    class="cursor-pointer rounded-xl border border-rule bg-sheet px-4 py-2 text-xs font-semibold text-ink shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition-colors hover:bg-well"
                    onClick={() => setLimit((l) => l + PAGE_SIZE)}
                  >
                    {t("jobs.showMore")}
                  </button>
                )}
                {limit > PAGE_SIZE && (
                  <button
                    type="button"
                    class="cursor-pointer rounded-xl border border-rule bg-sheet px-4 py-2 text-xs font-semibold text-ink-soft shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition-colors hover:bg-well hover:text-ink"
                    onClick={() => setLimit(PAGE_SIZE)}
                  >
                    {t("jobs.showLess")}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
