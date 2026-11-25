/**
 * Small form primitives. All are built on native inputs so keyboard and screen-reader
 * behaviour comes for free.
 */

import type { ComponentChildren } from "preact";
import { useId, useLayoutEffect, useRef, useState } from "preact/hooks";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** A labelled row in the settings form: label on the left on wide screens, stacked on narrow ones. */
export function Row(props: { label: ComponentChildren; htmlFor?: string; children: ComponentChildren; as?: "fieldset" | "div" }) {
  const { label, htmlFor, children, as = "div" } = props;
  const labelClass = "text-sm font-medium text-ink-soft sm:w-36 sm:shrink-0 sm:pt-2";
  if (as === "fieldset") {
    return (
      <fieldset class="m-0 flex min-w-0 flex-col gap-2 border-0 p-0 sm:flex-row sm:items-start sm:gap-4">
        <legend class={cx(labelClass, "float-left p-0")}>{label}</legend>
        <div class="min-w-0 flex-1">{children}</div>
      </fieldset>
    );
  }
  return (
    <div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
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

/** Segmented control backed by radio buttons, with a sliding active pill. */
export function Segmented<T extends string>(props: {
  name: string;
  value: T;
  options: ReadonlyArray<SegmentOption<T>>;
  onChange: (value: T) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; top: number; width: number; height: number; ready: boolean }>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    ready: false,
  });

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const active = track.querySelector<HTMLElement>('[data-active="true"]');
      if (!active) return;
      setThumb((prev) => ({
        left: active.offsetLeft,
        top: active.offsetTop,
        width: active.offsetWidth,
        height: active.offsetHeight,
        ready: prev.width > 0,
      }));
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(track);
    return () => ro?.disconnect();
  }, [props.value, props.options.length]);

  return (
    <div ref={trackRef} class="relative inline-flex max-w-full flex-wrap gap-0.5 rounded-xl border border-rule/70 bg-well p-1">
      {thumb.width > 0 && (
        <span
          aria-hidden="true"
          class={cx(
            "pointer-events-none absolute top-0 left-0 rounded-lg bg-sheet shadow-[0_1px_2px_rgb(15_23_42/0.08)] ring-1 ring-black/5 dark:ring-white/10",
            thumb.ready && "transition-[transform,width,height] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
          )}
          style={{
            width: `${thumb.width}px`,
            height: `${thumb.height}px`,
            transform: `translate3d(${thumb.left}px, ${thumb.top}px, 0)`,
          }}
        />
      )}
      {props.options.map((o) => {
        const active = props.value === o.value;
        return (
          <label
            key={o.value}
            data-active={active ? "true" : undefined}
            class={cx(
              "relative z-10 cursor-pointer select-none whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
              active ? "font-semibold text-ink" : "text-ink-soft hover:text-ink",
            )}
          >
            <input
              type="radio"
              class="sr-only"
              name={props.name}
              value={o.value}
              checked={active}
              onChange={() => props.onChange(o.value)}
            />
            {o.label}
          </label>
        );
      })}
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
    <div class="relative w-full max-w-xs">
      <select
        id={props.id}
        class="h-10 w-full cursor-pointer appearance-none rounded-xl border border-rule bg-sheet py-1.5 pr-9 pl-3.5 text-sm text-ink shadow-[0_1px_2px_rgb(15_23_42/0.03)] transition-colors hover:border-rule-strong focus-visible:border-accent"
        value={props.value}
        onChange={(e) => props.onChange((e.currentTarget as HTMLSelectElement).value as T)}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        class="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-ink-faint"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M4.5 6.5 8 10l3.5-3.5" />
      </svg>
    </div>
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
  const button =
    "grid h-10 w-10 cursor-pointer place-items-center text-ink-soft transition-colors hover:bg-well hover:text-ink active:bg-rule/60 disabled:cursor-not-allowed disabled:text-ink-faint/50 disabled:hover:bg-transparent";
  return (
    <div class="inline-flex items-stretch overflow-hidden rounded-xl border border-rule bg-sheet shadow-[0_1px_2px_rgb(15_23_42/0.03)]">
      <button type="button" class={button} aria-label={props.decreaseLabel} disabled={props.value <= props.min} onClick={() => props.onChange(clamp(props.value - 1))}>
        <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <path d="M3.5 8h9" />
        </svg>
      </button>
      <input
        id={props.id}
        type="number"
        inputMode="numeric"
        min={props.min}
        max={props.max}
        value={props.value}
        class="tabular w-16 border-x border-rule bg-transparent text-center text-sm font-semibold text-ink [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
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
        <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
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
        "h-10 w-full max-w-xs rounded-xl border bg-sheet px-3.5 text-sm text-ink shadow-[0_1px_2px_rgb(15_23_42/0.03)] transition-colors",
        props.invalid ? "border-error focus-visible:border-error" : "border-rule hover:border-rule-strong focus-visible:border-accent",
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
      class="relative h-2 w-full overflow-hidden rounded-full bg-well ring-1 ring-inset ring-black/5 dark:ring-white/5"
      role="meter"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={props.percent === null ? undefined : min === max ? max : Math.round((min + max) / 2)}
    >
      {max > min && <div class="absolute inset-y-0 left-0 rounded-full opacity-35 transition-[width] duration-300" style={{ width: `${max}%`, background: props.color }} />}
      <div class="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300" style={{ width: `${min}%`, background: props.color }} />
    </div>
  );
}
