/**
 * Printer status building blocks: device state badge, toner/drum meters and tray list.
 */

import { useT, formatRelative } from "../../i18n";
import type { DeviceState, PrinterStatus, Severity, Supply, SupplyColor, Tray } from "../../printer/types";
import { isUnmapped } from "../../printer/types";
import { Meter, cx } from "./controls";

const PROCESS_COLOR: Record<SupplyColor, string> = {
  black: "var(--color-process-k)",
  cyan: "var(--color-process-c)",
  magenta: "var(--color-process-m)",
  yellow: "var(--color-process-y)",
};

const SEVERITY_TEXT: Record<Severity, string> = {
  ok: "text-ok",
  info: "text-ink-soft",
  warning: "text-warn",
  error: "text-error",
  unknown: "text-ink-soft",
};

const SEVERITY_DOT: Record<Severity, string> = {
  ok: "bg-ok",
  info: "bg-ink-faint",
  warning: "bg-warn",
  error: "bg-error",
  unknown: "bg-ink-faint",
};

const SEVERITY_BADGE: Record<Severity, string> = {
  ok: "bg-ok-wash text-ok",
  info: "bg-well text-ink-soft",
  warning: "bg-warn-wash text-warn",
  error: "bg-error-wash text-error",
  unknown: "bg-well text-ink-soft",
};

export function severityTextClass(s: Severity): string {
  return SEVERITY_TEXT[s];
}

/** Combine the device's own state with the queue: a running job means "printing". */
export function effectiveState(status: PrinterStatus | undefined, printing: boolean, offline: boolean): { state: DeviceState | { raw: string }; severity: Severity } {
  if (offline) return { state: "offline", severity: "error" };
  if (!status) return { state: { raw: "…" }, severity: "unknown" };
  if (printing) return { state: "printing", severity: "ok" };
  const { state, severity } = status.device;
  return { state, severity };
}

export function DeviceBadge(props: { state: DeviceState | { raw: string }; severity: Severity }) {
  const { t } = useT();
  const text = isUnmapped(props.state) ? props.state.raw : t(`device.state.${props.state}`);
  const sleeping = props.state === "sleep";
  return (
    <span
      class={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        sleeping ? "bg-well text-ink-soft" : SEVERITY_BADGE[props.severity],
      )}
      title={sleeping ? t("device.sleepHint") : undefined}
    >
      <span
        class={cx("h-1.5 w-1.5 rounded-full", sleeping ? "bg-ink-faint" : SEVERITY_DOT[props.severity], props.state === "printing" && "animate-pulse")}
        aria-hidden="true"
      />
      <span>{text}</span>
    </span>
  );
}

function supplyStateText(t: ReturnType<typeof useT>["t"], s: Supply): string {
  return isUnmapped(s.state) ? s.state.raw : t(`supplies.state.${s.state}`, { percent: s.measured?.percent ?? s.level?.max ?? "" });
}

/** Order toners the way people say them: C, M, Y, K. */
const COLOR_ORDER: SupplyColor[] = ["cyan", "magenta", "yellow", "black"];

function sortByColor(list: Supply[]): Supply[] {
  return [...list].sort((a, b) => COLOR_ORDER.indexOf(a.color ?? "black") - COLOR_ORDER.indexOf(b.color ?? "black"));
}

export function lowToners(supplies: Supply[]): Supply[] {
  return sortByColor(supplies.filter((s) => s.kind === "toner" && s.severity !== "ok"));
}

function levelText(t: ReturnType<typeof useT>["t"], s: Supply): string {
  if (s.measured) return `${s.measured.percent}%`;
  if (!s.level) return "—";
  return s.level.min === s.level.max ? `${s.level.max}%` : t("supplies.range", { min: s.level.min, max: s.level.max });
}

export function SupplyList(props: { supplies: Supply[]; kind: "toner" | "drum"; showState?: boolean; compact?: boolean }) {
  const { t, lang } = useT();
  const list = sortByColor(props.supplies.filter((s) => s.kind === props.kind));
  const approximate = list.some((s) => !s.measured && s.level && s.level.min !== s.level.max);
  // The oldest measurement is the one worth mentioning.
  const measuredAt = list.reduce<Date | null>((oldest, s) => (s.measured && (!oldest || s.measured.at < oldest) ? s.measured.at : oldest), null);
  return (
    <>
      <ul class={cx("m-0 list-none p-0", props.compact ? "grid grid-cols-2 gap-3" : "flex flex-col gap-3.5")}>
        {list.map((s) => {
          const colorName = s.color ? t(`supplies.color.${s.color}`) : s.name;
          const flagged = s.severity === "warning" || s.severity === "error";
          return (
            <li key={s.name} class={cx("flex flex-col gap-1.5", props.compact && "rounded-xl bg-well/45 px-3 py-2.5")}>
              <div class="flex items-baseline justify-between gap-2 text-xs sm:text-sm">
                <span class="flex min-w-0 items-center gap-1.5">
                  <span
                    class="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/15 dark:ring-white/20"
                    style={{ background: s.color ? PROCESS_COLOR[s.color] : "var(--color-ink-faint)" }}
                    aria-hidden="true"
                  />
                  <span class={cx("truncate font-medium text-ink", props.compact && "text-xs")}>{colorName}</span>
                </span>
                <span class={cx("tabular shrink-0 text-xs font-semibold", flagged ? SEVERITY_TEXT[s.severity] : "text-ink-soft")}>{levelText(t, s)}</span>
              </div>
              <Meter
                percent={s.measured?.percent ?? s.level?.max ?? null}
                min={s.measured?.percent ?? s.level?.min ?? null}
                color={s.color ? PROCESS_COLOR[s.color] : "var(--color-ink-faint)"}
                label={`${colorName} ${levelText(t, s)}`}
              />
              {(flagged || props.showState) && <p class={cx("m-0 text-[11px] leading-snug", SEVERITY_TEXT[s.severity])}>{supplyStateText(t, s)}</p>}
            </li>
          );
        })}
      </ul>
      {measuredAt && <p class="m-0 mt-3 text-[11px] leading-relaxed text-ink-faint">{t("supplies.measuredNote", { time: formatRelative(measuredAt, lang) })}</p>}
      {approximate && <p class="m-0 mt-3 text-[11px] leading-relaxed text-ink-faint">{t("supplies.rangeNote")}</p>}
    </>
  );
}

export function WasteToner(props: { supplies: Supply[] }) {
  const { t } = useT();
  const s = props.supplies.find((x) => x.kind === "wasteToner");
  if (!s) return null;
  return (
    <div class="flex items-center justify-between gap-3 rounded-xl bg-well/60 px-3.5 py-2.5 text-sm">
      <span class="font-medium text-ink">{t("supplies.wasteToner")}</span>
      <span class={cx("text-xs font-semibold", SEVERITY_TEXT[s.severity])}>{supplyStateText(t, s)}</span>
    </div>
  );
}

export function trayName(t: ReturnType<typeof useT>["t"], tray: Tray): string {
  return isUnmapped(tray.id) ? tray.id.raw : t(`tray.${tray.id}`);
}

export function trayPaper(t: ReturnType<typeof useT>["t"], tray: Tray): string {
  const size = tray.size === null ? null : isUnmapped(tray.size) ? tray.size.raw : t(`paperSize.${tray.size}`);
  const media = tray.media === null ? null : isUnmapped(tray.media) ? tray.media.raw : t(`media.${tray.media}`);
  return [size, media].filter(Boolean).join(" ");
}

/**
 * Paper left in a tray. The tray sensor only tells four levels: the web page and SNMP both give
 * multiples of a quarter (e.g. 420 of 560 sheets), so this shows quarters, not a precise-looking
 * percentage. Other values (another model) fall back to "about N%".
 */
function TrayLevel(props: { percent: number }) {
  const { t } = useT();
  const percent = Math.max(0, Math.min(100, props.percent));
  const quarters = percent % 25 === 0 ? percent / 25 : null;
  const text = quarters !== null ? t(`trays.quarters.${quarters}`) : t("trays.about", { percent });
  const filled = quarters ?? Math.round(percent / 25);
  return (
    <div class="flex shrink-0 items-center gap-2" title={t("trays.sensorNote")}>
      <span class="hidden gap-0.5 sm:flex" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} class={cx("h-1.5 w-2.5 rounded-sm", i < filled ? "bg-ink-soft/60" : "bg-rule")} />
        ))}
      </span>
      <span class={cx("text-right text-xs font-semibold whitespace-nowrap", filled === 0 ? "text-warn" : "text-ink-soft")}>{text}</span>
    </div>
  );
}

export function TrayList(props: { trays: Tray[] }) {
  const { t } = useT();
  return (
    <ul class="m-0 flex list-none flex-col gap-2 p-0">
      {props.trays.map((tray) => {
        const name = trayName(t, tray);
        const problem = tray.state !== "ok";
        return (
          <li key={name} class="flex items-center justify-between gap-3 rounded-xl bg-well/45 px-3 py-2 text-sm">
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline gap-2">
                <span class="shrink-0 text-xs font-semibold text-ink sm:text-sm">{name}</span>
                <span class="truncate text-xs text-ink-soft">{trayPaper(t, tray) || "—"}</span>
              </div>
            </div>
            {problem ? (
              <span class="shrink-0 rounded-full bg-error-wash px-2 py-0.5 text-[11px] font-semibold text-error">{t(`trayState.${tray.state}`)}</span>
            ) : tray.levelPercent !== null ? (
              <TrayLevel percent={tray.levelPercent} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Section heading used inside panels. */
export function PanelHeading(props: { children: string }) {
  return <h2 class="m-0 mb-3 text-sm font-bold tracking-tight text-ink">{props.children}</h2>;
}
