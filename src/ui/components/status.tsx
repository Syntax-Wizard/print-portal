/**
 * Printer status building blocks: device state badge, toner/drum meters and tray list.
 */

import { useT } from "../../i18n";
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
    <span class="inline-flex items-center gap-2 text-sm font-semibold" title={sleeping ? t("device.sleepHint") : undefined}>
      <span class={cx("h-2.5 w-2.5 rounded-full", sleeping ? "bg-ink-faint" : SEVERITY_DOT[props.severity], props.state === "printing" && "animate-pulse")} aria-hidden="true" />
      <span class={sleeping ? "text-ink-soft" : SEVERITY_TEXT[props.severity]}>{text}</span>
    </span>
  );
}

function supplyStateText(t: ReturnType<typeof useT>["t"], s: Supply): string {
  return isUnmapped(s.state) ? s.state.raw : t(`supplies.state.${s.state}`);
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
  if (!s.level) return "—";
  return s.level.min === s.level.max ? `${s.level.max}%` : t("supplies.range", { min: s.level.min, max: s.level.max });
}

export function SupplyList(props: { supplies: Supply[]; kind: "toner" | "drum"; showState?: boolean }) {
  const { t } = useT();
  const list = sortByColor(props.supplies.filter((s) => s.kind === props.kind));
  const approximate = list.some((s) => s.level && s.level.min !== s.level.max);
  return (
    <>
    <ul class="m-0 flex list-none flex-col gap-3 p-0">
      {list.map((s) => {
        const colorName = s.color ? t(`supplies.color.${s.color}`) : s.name;
        const flagged = s.severity === "warning" || s.severity === "error";
        return (
          <li key={s.name} class="flex flex-col gap-1">
            <div class="flex items-baseline justify-between gap-3 text-sm">
              <span class="flex items-center gap-2">
                <span class="h-3 w-3 rounded-sm border border-rule" style={{ background: s.color ? PROCESS_COLOR[s.color] : "var(--color-ink-faint)" }} aria-hidden="true" />
                <span class="font-semibold">{colorName}</span>
              </span>
              <span class="tabular text-ink-soft">{levelText(t, s)}</span>
            </div>
            <Meter
              percent={s.level?.max ?? null}
              min={s.level?.min ?? null}
              color={s.color ? PROCESS_COLOR[s.color] : "var(--color-ink-faint)"}
              label={`${colorName} ${levelText(t, s)}`}
            />
            {(flagged || props.showState) && <p class={cx("m-0 text-xs", SEVERITY_TEXT[s.severity])}>{supplyStateText(t, s)}</p>}
          </li>
        );
      })}
    </ul>
    {approximate && <p class="m-0 mt-3 text-xs leading-relaxed text-ink-faint">{t("supplies.rangeNote")}</p>}
    </>
  );
}

export function WasteToner(props: { supplies: Supply[] }) {
  const { t } = useT();
  const s = props.supplies.find((x) => x.kind === "wasteToner");
  if (!s) return null;
  return (
    <p class="m-0 flex items-baseline justify-between gap-3 text-sm">
      <span class="font-semibold">{t("supplies.wasteToner")}</span>
      <span class={SEVERITY_TEXT[s.severity]}>{supplyStateText(t, s)}</span>
    </p>
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

export function TrayList(props: { trays: Tray[] }) {
  const { t } = useT();
  return (
    <ul class="m-0 flex list-none flex-col gap-2.5 p-0">
      {props.trays.map((tray) => {
        const name = trayName(t, tray);
        const problem = tray.state !== "ok";
        return (
          <li key={name} class="grid grid-cols-[6.5rem_1fr_auto] items-center gap-x-3 text-sm">
            <span class="font-semibold">{name}</span>
            <span class="truncate text-ink-soft">{trayPaper(t, tray) || "—"}</span>
            <span class={cx("tabular text-right", problem ? "font-semibold text-error" : "text-ink-soft")}>
              {problem ? t(`trayState.${tray.state}`) : tray.levelPercent !== null ? `${tray.levelPercent}%` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Section heading used inside panels. Sentence case, no decoration. */
export function PanelHeading(props: { children: string }) {
  return <h2 class="m-0 mb-3 text-sm font-bold text-ink">{props.children}</h2>;
}
