/**
 * Print settings. Everyday choices are always visible in a compact 2-column rhythm;
 * collate, paper type and the special job types live under "More settings".
 */

import type { ComponentChildren } from "preact";
import type { TFunction } from "i18next";
import { useT } from "../../i18n";
import { LIMITS, type OptionsValidationError } from "../../printer/options";
import type { Delivery, MediaType, PaperSize, PrintOptions, Tray, TrayId } from "../../printer/types";
import { isUnmapped } from "../../printer/types";
import { Row, Segmented, Select, Stepper, TextInput, useFieldId } from "./controls";
import { trayName, trayPaper } from "./status";

const PAPER_SIZES: PaperSize[] = ["A4", "A3", "B4", "B5", "A5", "letter", "legal", "ledger", "folio", "11x15"];
const MEDIA: MediaType[] = ["plain", "bond", "recycled", "user1", "user2", "user3", "user4", "user5"];
const TRAY_IDS: TrayId[] = ["T1", "T2", "T3", "T4", "bypass"];

function trayOptions(t: TFunction, trays: Tray[]) {
  const known = new Map(trays.filter((tr) => !isUnmapped(tr.id)).map((tr) => [tr.id as TrayId, tr]));
  return [
    { value: "auto" as const, label: t("options.tray.auto") },
    ...TRAY_IDS.map((id) => {
      const tray = known.get(id);
      const paper = tray ? trayPaper(t, tray) : "";
      const name = tray ? trayName(t, tray) : t(`tray.${id}`);
      return {
        value: id,
        label: paper ? t("options.tray.loaded", { tray: name, paper }) : name,
        disabled: tray?.state === "unavailable",
      };
    }),
  ];
}

function FieldBlock(props: { label: string; htmlFor?: string; as?: "fieldset" | "div"; children: ComponentChildren }) {
  const labelClass = "mb-2 block text-xs font-semibold tracking-wide text-ink-soft";
  if (props.as === "fieldset") {
    return (
      <fieldset class="m-0 min-w-0 border-0 p-0">
        <legend class={labelClass}>{props.label}</legend>
        {props.children}
      </fieldset>
    );
  }
  return (
    <div class="min-w-0">
      <label class={labelClass} for={props.htmlFor}>
        {props.label}
      </label>
      {props.children}
    </div>
  );
}

function DuplexIcon({ mode }: { mode: PrintOptions["duplex"] }) {
  if (mode === "none") {
    return (
      <svg class="h-3.5 w-3.5 shrink-0 opacity-70" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <rect x="3.5" y="2" width="9" height="12" rx="1.2" />
      </svg>
    );
  }
  if (mode === "long-edge") {
    return (
      <svg class="h-3.5 w-3.5 shrink-0 opacity-70" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <rect x="3" y="2" width="8.5" height="11" rx="1.2" />
        <path d="M5.5 14h6.2a1 1 0 0 0 1-1V4.5" />
        <path d="M1.5 5h1.5M1.5 8h1.5M1.5 11h1.5" stroke-linecap="round" />
      </svg>
    );
  }
  return (
    <svg class="h-3.5 w-3.5 shrink-0 opacity-70" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <rect x="3" y="3" width="8.5" height="10.5" rx="1.2" />
      <path d="M5.5 14.5h6.2a1 1 0 0 0 1-1V5.5" />
      <path d="M5.2 1.5v1.5M7.3 1.5v1.5M9.4 1.5v1.5" stroke-linecap="round" />
    </svg>
  );
}

function ColorSwatch({ mode }: { mode: PrintOptions["color"] }) {
  if (mode === "bw") {
    return (
      <span
        class="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-black/20 dark:ring-white/25"
        style={{ background: "linear-gradient(135deg, #1f242b 50%, #d4d8df 50%)" }}
        aria-hidden="true"
      />
    );
  }
  if (mode === "color") {
    return (
      <span
        class="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-black/15 dark:ring-white/20"
        style={{ background: "conic-gradient(var(--color-process-c) 0 120deg, var(--color-process-m) 120deg 240deg, var(--color-process-y) 240deg 360deg)" }}
        aria-hidden="true"
      />
    );
  }
  return (
    <svg class="h-3.5 w-3.5 shrink-0 opacity-70" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke-dasharray="2.5 2" />
    </svg>
  );
}

export function OptionsForm(props: {
  options: PrintOptions;
  onChange: (options: PrintOptions) => void;
  trays: Tray[];
  errors: OptionsValidationError[];
}) {
  const { t } = useT();
  const { options: o, onChange } = props;
  const set = <K extends keyof PrintOptions>(key: K, value: PrintOptions[K]) => onChange({ ...o, [key]: value });
  const ids = {
    copies: useFieldId("copies"),
    size: useFieldId("size"),
    tray: useFieldId("tray"),
    media: useFieldId("media"),
    userId: useFieldId("uid"),
    pin: useFieldId("pin"),
    hour: useFieldId("hour"),
    deliveryHint: useFieldId("dhint"),
  };
  const err = (code: OptionsValidationError) => props.errors.includes(code);

  return (
    <div class="flex flex-col gap-5">
      {/* Primary settings in a clean studio grid; 3-way segmented controls span full width so English labels never wrap */}
      <div class="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <div class="sm:col-span-2">
          <FieldBlock as="fieldset" label={t("options.duplex.label")}>
            <Segmented
              name="duplex"
              value={o.duplex}
              options={(["none", "long-edge", "short-edge"] as const).map((v) => ({
                value: v,
                label: (
                  <span class="inline-flex items-center gap-1.5">
                    <DuplexIcon mode={v} />
                    {t(`options.duplex.${v}`)}
                  </span>
                ),
              }))}
              onChange={(v) => set("duplex", v)}
            />
          </FieldBlock>
        </div>

        <div class="sm:col-span-2">
          <FieldBlock as="fieldset" label={t("options.color.label")}>
            <Segmented
              name="color"
              value={o.color}
              options={(["auto", "color", "bw"] as const).map((v) => ({
                value: v,
                label: (
                  <span class="inline-flex items-center gap-1.5">
                    <ColorSwatch mode={v} />
                    {t(`options.color.${v}`)}
                  </span>
                ),
              }))}
              onChange={(v) => set("color", v)}
            />
          </FieldBlock>
        </div>

        <FieldBlock label={t("options.copies")} htmlFor={ids.copies}>
          <Stepper
            id={ids.copies}
            value={o.copies}
            min={LIMITS.copiesMin}
            max={LIMITS.copiesMax}
            onChange={(n) => set("copies", n)}
            decreaseLabel={t("options.copiesDecrease")}
            increaseLabel={t("options.copiesIncrease")}
          />
          {err("copiesOutOfRange") && <p class="m-0 mt-1.5 text-xs font-medium text-error">{t("options.errors.copiesOutOfRange")}</p>}
        </FieldBlock>

        <FieldBlock as="fieldset" label={t("options.pagesPerSheet.label")}>
          <Segmented
            name="pagesPerSheet"
            value={String(o.pagesPerSheet) as "1" | "2" | "4"}
            options={(["1", "2", "4"] as const).map((v) => ({ value: v, label: t(`options.pagesPerSheet.${v}`) }))}
            onChange={(v) => set("pagesPerSheet", Number(v) as PrintOptions["pagesPerSheet"])}
          />
          {o.pagesPerSheet > 1 && <p class="m-0 mt-1.5 text-xs text-ink-faint">{t("options.pagesPerSheet.hint")}</p>}
        </FieldBlock>

        <FieldBlock label={t("options.paperSize.label")} htmlFor={ids.size}>
          <Select
            id={ids.size}
            value={o.paperSize}
            options={[{ value: "default" as const, label: t("options.paperSize.default") }, ...PAPER_SIZES.map((s) => ({ value: s, label: t(`paperSize.${s}`) }))]}
            onChange={(v) => set("paperSize", v)}
          />
        </FieldBlock>

        <FieldBlock label={t("options.tray.label")} htmlFor={ids.tray}>
          <Select id={ids.tray} value={o.tray} options={trayOptions(t, props.trays)} onChange={(v) => set("tray", v)} />
        </FieldBlock>
      </div>

      {/* Advanced settings */}
      <details class="group border-t border-rule/80 pt-4" open={o.delivery.type !== "normal" || o.collate !== "default" || o.media !== "default" || undefined}>
        <summary class="inline-flex cursor-pointer list-none items-center gap-2 rounded-xl bg-well/70 px-3.5 py-2 text-xs font-semibold text-ink-soft transition-colors hover:bg-well hover:text-ink [&::-webkit-details-marker]:hidden">
          <svg
            class="h-3.5 w-3.5 text-ink-faint transition-transform duration-150 group-open:rotate-90"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M6 4.5 10 8l-4 3.5" />
          </svg>
          {t("options.advanced")}
        </summary>
        <div class="mt-4 flex flex-col gap-5 rounded-xl border border-rule/80 bg-paper/55 p-4 sm:p-5">
          <Row as="fieldset" label={t("options.collate.label")}>
            <Segmented
              name="collate"
              value={o.collate}
              options={(["default", "on", "off"] as const).map((v) => ({ value: v, label: t(`options.collate.${v}`) }))}
              onChange={(v) => set("collate", v)}
            />
          </Row>

          <Row label={t("options.media.label")} htmlFor={ids.media}>
            <Select
              id={ids.media}
              value={o.media}
              options={[{ value: "default" as const, label: t("options.media.default") }, ...MEDIA.map((m) => ({ value: m, label: t(`media.${m}`) }))]}
              onChange={(v) => set("media", v)}
            />
          </Row>

          <Row as="fieldset" label={t("options.delivery.label")}>
            <DeliveryChooser delivery={o.delivery} onChange={(d) => set("delivery", d)} hintId={ids.deliveryHint} />
            <p id={ids.deliveryHint} class="m-0 mt-2.5 max-w-prose rounded-xl bg-well/70 px-3.5 py-2.5 text-xs leading-relaxed text-ink-soft">
              {t(`options.delivery.${o.delivery.type}Hint`)}
            </p>

            {(o.delivery.type === "secure" || o.delivery.type === "sample") && (
              <div class="mt-3.5 flex flex-col gap-3.5">
                <div>
                  <label class="mb-1.5 block text-xs font-semibold text-ink-soft" for={ids.userId}>
                    {t("options.delivery.userId")}
                  </label>
                  <TextInput
                    id={ids.userId}
                    value={o.delivery.userId}
                    maxLength={LIMITS.userIdMaxLength}
                    autoComplete="username"
                    invalid={err("userIdRequired") || err("userIdTooLong")}
                    onInput={(v) => set("delivery", { ...o.delivery, userId: v } as Delivery)}
                  />
                  {err("userIdRequired") && <p class="m-0 mt-1.5 text-xs font-medium text-error">{t("options.errors.userIdRequired")}</p>}
                </div>
                {o.delivery.type === "secure" && (
                  <div>
                    <label class="mb-1.5 block text-xs font-semibold text-ink-soft" for={ids.pin}>
                      {t("options.delivery.pin")}
                    </label>
                    <TextInput
                      id={ids.pin}
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      value={o.delivery.pin}
                      maxLength={LIMITS.pinMaxLength}
                      invalid={err("pinInvalid")}
                      onInput={(v) => set("delivery", { ...o.delivery, pin: v.replace(/\D/g, "") } as Delivery)}
                    />
                    <p class="m-0 mt-1.5 text-xs text-ink-faint">{t("options.delivery.pinNote")}</p>
                    {err("pinInvalid") && <p class="m-0 mt-1.5 text-xs font-medium text-error">{t("options.errors.pinInvalid")}</p>}
                  </div>
                )}
              </div>
            )}

            {o.delivery.type === "delayed" && (
              <div class="mt-3.5">
                <label class="mb-1.5 block text-xs font-semibold text-ink-soft" for={ids.hour}>
                  {t("options.delivery.time")}
                </label>
                <input
                  id={ids.hour}
                  type="time"
                  class="h-10 rounded-xl border border-rule bg-sheet px-3.5 text-sm text-ink shadow-[0_1px_2px_rgb(15_23_42/0.03)] transition-colors hover:border-rule-strong focus-visible:border-accent"
                  value={`${String(o.delivery.hour).padStart(2, "0")}:${String(o.delivery.minute).padStart(2, "0")}`}
                  onInput={(e) => {
                    const [h, m] = (e.currentTarget as HTMLInputElement).value.split(":").map(Number);
                    if (Number.isFinite(h) && Number.isFinite(m)) set("delivery", { type: "delayed", hour: h!, minute: m! });
                  }}
                />
                {err("timeInvalid") && <p class="m-0 mt-1.5 text-xs font-medium text-error">{t("options.errors.timeInvalid")}</p>}
              </div>
            )}
          </Row>
        </div>
      </details>
    </div>
  );
}

function DeliveryChooser(props: { delivery: Delivery; onChange: (d: Delivery) => void; hintId: string }) {
  const { t } = useT();
  const make = (type: Delivery["type"]): Delivery => {
    const prevUser = "userId" in props.delivery ? props.delivery.userId : "";
    switch (type) {
      case "normal":
        return { type };
      case "secure":
        return { type, userId: prevUser, pin: "" };
      case "sample":
        return { type, userId: prevUser };
      case "delayed": {
        const later = new Date(Date.now() + 60 * 60_000);
        return { type, hour: later.getHours(), minute: 0 };
      }
    }
  };
  return (
    <div aria-describedby={props.hintId}>
      <Segmented
        name="delivery"
        value={props.delivery.type}
        options={(["normal", "secure", "sample", "delayed"] as const).map((v) => ({ value: v, label: t(`options.delivery.${v}`) }))}
        onChange={(v) => props.onChange(make(v))}
      />
    </div>
  );
}
