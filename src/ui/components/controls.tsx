/**
 * Small form primitives. All are built on native inputs so keyboard and screen-reader
 * behaviour comes for free.
 */

import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** A labelled row in the settings form: label on the left on wide screens, stacked on narrow ones. */
export function Row(props: { label: ComponentChildren; htmlFor?: string; children: ComponentChildren; as?: "fieldset" | "div" }) {
  const { label, htmlFor, children, as = "div" } = props;
  const labelClass = "pt-2 text-sm font-semibold text-ink-soft sm:w-36 sm:shrink-0";
  if (as === "fieldset") {
    return (
      <fieldset class="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0 sm:flex-row sm:gap-4">
        <legend class={cx(labelClass, "float-left p-0")}>{label}</legend>
        <div class="min-w-0 flex-1">{children}</div>
      </fieldset>
    );
  }
  return (
    <div class="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:gap-4">
      <label class={labelClass} for={htmlFor}>
        {label}
      </label>
      <div class="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ComponentChildren;
}

/** Segmented control backed by radio buttons. */
export function Segmented<T extends string>(props: {
  name: string;
  value: T;
  options: ReadonlyArray<SegmentOption<T>>;
  onChange: (value: T) => void;
}) {
  return (
    <div class="inline-flex max-w-full flex-wrap rounded-lg border border-rule bg-sheet p-0.5">
      {props.options.map((o) => (
        <label
          key={o.value}
          class={cx(
            "relative cursor-pointer rounded-md px-3.5 py-1.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
            props.value === o.value ? "bg-ink font-semibold text-paper" : "text-ink hover:bg-paper",
          )}
        >
          <input
            type="radio"
            class="sr-only"
            name={props.name}
            value={o.value}
            checked={props.value === o.value}
            onChange={() => props.onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export function Select<T extends string>(props: {
  id: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>;
  onChange: (value: T) => void;
}) {
  return (
    <select
      id={props.id}
      class="w-full max-w-xs rounded-lg border border-rule bg-sheet px-3 py-1.5 text-sm text-ink"
      value={props.value}
      onChange={(e) => props.onChange((e.currentTarget as HTMLSelectElement).value as T)}
    >
      {props.options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Stepper(props: {
  id: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  decreaseLabel: string;
  increaseLabel: string;
}) {
  const clamp = (n: number) => Math.min(props.max, Math.max(props.min, n));
  const button = "grid h-9 w-9 place-items-center text-lg text-ink hover:bg-paper disabled:text-ink-faint disabled:hover:bg-transparent";
  return (
    <div class="inline-flex items-stretch overflow-hidden rounded-lg border border-rule bg-sheet">
      <button type="button" class={button} aria-label={props.decreaseLabel} disabled={props.value <= props.min} onClick={() => props.onChange(clamp(props.value - 1))}>
        −
      </button>
      <input
        id={props.id}
        type="number"
        inputMode="numeric"
        min={props.min}
        max={props.max}
        value={props.value}
        class="tabular w-16 border-x border-rule bg-transparent text-center text-base font-semibold text-ink [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        onInput={(e) => {
          const n = parseInt((e.currentTarget as HTMLInputElement).value, 10);
          if (Number.isFinite(n)) props.onChange(n);
        }}
        onBlur={(e) => {
          const n = parseInt((e.currentTarget as HTMLInputElement).value, 10);
          props.onChange(clamp(Number.isFinite(n) ? n : props.min));
        }}
      />
      <button type="button" class={button} aria-label={props.increaseLabel} disabled={props.value >= props.max} onClick={() => props.onChange(clamp(props.value + 1))}>
        +
      </button>
    </div>
  );
}

export function TextInput(props: {
  id: string;
  value: string;
  onInput: (value: string) => void;
  type?: "text" | "password";
  inputMode?: "numeric" | "text";
  maxLength?: number;
  autoComplete?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <input
      id={props.id}
      // Preact types model each input type separately; both variants share these props.
      type={(props.type ?? "text") as "text"}
      inputMode={props.inputMode}
      maxLength={props.maxLength}
      autoComplete={props.autoComplete ?? "off"}
      value={props.value}
      aria-invalid={props.invalid || undefined}
      aria-describedby={props.describedBy}
      class={cx(
        "w-full max-w-xs rounded-lg border bg-sheet px-3 py-1.5 text-sm text-ink",
        props.invalid ? "border-error" : "border-rule",
      )}
      onInput={(e) => props.onInput((e.currentTarget as HTMLInputElement).value)}
    />
  );
}

export function useFieldId(prefix: string): string {
  return `${prefix}-${useId()}`;
}

/**
 * Thin horizontal level meter. When only a range is known, the certain part (up to `min`)
 * is solid and the uncertain part (from `min` to `percent`) is drawn faintly.
 */
export function Meter(props: { percent: number | null; min?: number | null; color: string; label: string }) {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const max = props.percent === null ? 0 : clamp(props.percent);
  const min = props.min === null || props.min === undefined ? max : Math.min(max, clamp(props.min));
  return (
    <div
      class="relative h-1.5 w-full overflow-hidden rounded-full bg-rule"
      role="meter"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={props.percent === null ? undefined : min === max ? max : Math.round((min + max) / 2)}
    >
      {max > min && <div class="absolute inset-y-0 left-0 rounded-full opacity-35" style={{ width: `${max}%`, background: props.color }} />}
      <div class="absolute inset-y-0 left-0 rounded-full" style={{ width: `${min}%`, background: props.color }} />
    </div>
  );
}
