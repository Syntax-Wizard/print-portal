/**
 * Print settings. Everyday choices are always visible; collate, paper type and the
 * special job types live under "More settings".
 */

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

type Preset = "duplexBw" | "simplexColor" | "custom";

function presetOf(o: PrintOptions): Preset {
  if (o.duplex === "long-edge" && o.color === "bw") return "duplexBw";
  if (o.duplex === "none" && o.color === "color") return "simplexColor";
  return "custom";
}

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
  const preset = presetOf(o);
  const err = (code: OptionsValidationError) => props.errors.includes(code);

  return (
    <div class="flex flex-col gap-5">
      <Row as="fieldset" label={t("options.presets.label")}>
        <Segmented<Preset>
          name="preset"
          value={preset}
          options={[
            { value: "duplexBw", label: t("options.presets.duplexBw") },
            { value: "simplexColor", label: t("options.presets.simplexColor") },
            ...(preset === "custom" ? [{ value: "custom" as const, label: t("options.presets.custom") }] : []),
          ]}
          onChange={(p) => {
            if (p === "duplexBw") onChange({ ...o, duplex: "long-edge", color: "bw" });
            if (p === "simplexColor") onChange({ ...o, duplex: "none", color: "color" });
          }}
        />
      </Row>

      <hr class="m-0 border-0 border-t border-rule" />

      <Row label={t("options.copies")} htmlFor={ids.copies}>
        <Stepper
          id={ids.copies}
          value={o.copies}
          min={LIMITS.copiesMin}
          max={LIMITS.copiesMax}
          onChange={(n) => set("copies", n)}
          decreaseLabel={t("options.copiesDecrease")}
          increaseLabel={t("options.copiesIncrease")}
        />
        {err("copiesOutOfRange") && <p class="m-0 mt-1 text-sm text-error">{t("options.errors.copiesOutOfRange")}</p>}
      </Row>

      <Row as="fieldset" label={t("options.duplex.label")}>
        <Segmented
          name="duplex"
          value={o.duplex}
          options={(["none", "long-edge", "short-edge"] as const).map((v) => ({ value: v, label: t(`options.duplex.${v}`) }))}
          onChange={(v) => set("duplex", v)}
        />
      </Row>

      <Row as="fieldset" label={t("options.color.label")}>
        <Segmented
          name="color"
          value={o.color}
          options={(["bw", "color", "auto"] as const).map((v) => ({ value: v, label: t(`options.color.${v}`) }))}
          onChange={(v) => set("color", v)}
        />
      </Row>

      <Row label={t("options.paperSize.label")} htmlFor={ids.size}>
        <Select
          id={ids.size}
          value={o.paperSize}
          options={[{ value: "default" as const, label: t("options.paperSize.default") }, ...PAPER_SIZES.map((s) => ({ value: s, label: t(`paperSize.${s}`) }))]}
          onChange={(v) => set("paperSize", v)}
        />
      </Row>

      <Row label={t("options.tray.label")} htmlFor={ids.tray}>
        <Select id={ids.tray} value={o.tray} options={trayOptions(t, props.trays)} onChange={(v) => set("tray", v)} />
      </Row>

      <details class="group" open={o.delivery.type !== "normal" || o.collate !== "default" || o.media !== "default" || undefined}>
        <summary class="cursor-pointer list-none text-sm font-semibold text-accent-ink [&::-webkit-details-marker]:hidden">
          <span class="inline-block transition-transform group-open:rotate-90" aria-hidden="true">
            ▸
          </span>{" "}
          {t("options.advanced")}
        </summary>
        <div class="mt-5 flex flex-col gap-5">
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
            <p id={ids.deliveryHint} class="m-0 mt-2 max-w-prose text-sm text-ink-soft">
              {t(`options.delivery.${o.delivery.type}Hint`)}
            </p>

            {(o.delivery.type === "secure" || o.delivery.type === "sample") && (
              <div class="mt-3 flex flex-col gap-3">
                <div>
                  <label class="mb-1 block text-sm" for={ids.userId}>
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
                  {err("userIdRequired") && <p class="m-0 mt-1 text-sm text-error">{t("options.errors.userIdRequired")}</p>}
                </div>
                {o.delivery.type === "secure" && (
                  <div>
                    <label class="mb-1 block text-sm" for={ids.pin}>
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
                    <p class="m-0 mt-1 text-xs text-ink-faint">{t("options.delivery.pinNote")}</p>
                    {err("pinInvalid") && <p class="m-0 mt-1 text-sm text-error">{t("options.errors.pinInvalid")}</p>}
                  </div>
                )}
              </div>
            )}

            {o.delivery.type === "delayed" && (
              <div class="mt-3">
                <label class="mb-1 block text-sm" for={ids.hour}>
                  {t("options.delivery.time")}
                </label>
                <input
                  id={ids.hour}
                  type="time"
                  class="rounded-lg border border-rule bg-sheet px-3 py-1.5 text-sm text-ink"
                  value={`${String(o.delivery.hour).padStart(2, "0")}:${String(o.delivery.minute).padStart(2, "0")}`}
                  onInput={(e) => {
                    const [h, m] = (e.currentTarget as HTMLInputElement).value.split(":").map(Number);
                    if (Number.isFinite(h) && Number.isFinite(m)) set("delivery", { type: "delayed", hour: h!, minute: m! });
                  }}
                />
                {err("timeInvalid") && <p class="m-0 mt-1 text-sm text-error">{t("options.errors.timeInvalid")}</p>}
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
