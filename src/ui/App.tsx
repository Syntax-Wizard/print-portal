import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { LANGUAGES, setLanguage, useT } from "../i18n";
import type { PrinterClient } from "../printer/client";
import { PrinterUnreachableError } from "../printer/client";
import { cx } from "./components/controls";
import { DeviceBadge, effectiveState, lowToners } from "./components/status";
import { MailboxPage } from "./pages/MailboxPage";
import { PrintPage } from "./pages/PrintPage";
import { StatusPage } from "./pages/StatusPage";
import { PrinterProvider, usePrinter } from "./PrinterContext";
import { SubmissionsProvider } from "./useSubmissions";
import { MailboxProvider } from "./useMailbox";
import { type Theme, applyTheme, loadTheme, saveTheme } from "./settings";

type View = "print" | "mailbox" | "status";
const VIEWS: View[] = ["print", "mailbox", "status"];
const THEMES: readonly Theme[] = ["system", "light", "dark"];

/** Keep the current view in the URL hash so the back button works inside the app. */
const hashName = () => location.hash.replace(/^#\/?/, "");

function viewFromHash(): View {
  const v = hashName();
  // The jobs tab was folded into the status page; keep old links working.
  if (v === "jobs") return "status";
  return (VIEWS as string[]).includes(v) ? (v as View) : "print";
}

function useView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>(viewFromHash);
  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return [view, (v) => (location.hash = `/${v}`)];
}

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const fadeTimer = useRef<number | null>(null);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq?.addEventListener("change", onChange);
    return () => mq?.removeEventListener("change", onChange);
  }, [theme]);
  useEffect(() => () => { if (fadeTimer.current !== null) window.clearTimeout(fadeTimer.current); }, []);
  return [
    theme,
    (t) => {
      const root = document.documentElement;
      root.classList.add("pp-theme-fading");
      if (fadeTimer.current !== null) window.clearTimeout(fadeTimer.current);
      fadeTimer.current = window.setTimeout(() => root.classList.remove("pp-theme-fading"), 360);
      saveTheme(t);
      setTheme(t);
    },
  ];
}

function BrandMark() {
  return (
    <span class="grid h-7 w-7 shrink-0 grid-cols-2 gap-1 rounded-lg bg-well p-1.5 ring-1 ring-inset ring-rule" aria-hidden="true">
      <span class="rounded-[2px]" style={{ background: "var(--color-process-c)" }} />
      <span class="rounded-[2px]" style={{ background: "var(--color-process-m)" }} />
      <span class="rounded-[2px]" style={{ background: "var(--color-process-y)" }} />
      <span class="rounded-[2px]" style={{ background: "var(--color-process-k)" }} />
    </span>
  );
}

function NavIcon({ view }: { view: View }) {
  if (view === "print") {
    return (
      <svg class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M5 7V3.5h10V7" />
        <rect x="3" y="7" width="14" height="7" rx="2" />
        <path d="M6 12h8v4.5H6V12Z" />
      </svg>
    );
  }
  if (view === "mailbox") {
    return (
      <svg class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 11.5 5.2 4.5h9.6l2.2 7" />
        <path d="M3 11.5V16h14v-4.5h-4.2l-1 2h-3.6l-1-2H3Z" />
      </svg>
    );
  }
  return (
    <svg class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 10h3l2.2-5 3.6 10 2.2-5H17" />
    </svg>
  );
}

function ThemeIcon({ mode }: { mode: Theme }) {
  if (mode === "light") {
    return (
      <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.58 3.58l1.06 1.06M11.36 11.36l1.06 1.06M12.42 3.58l-1.06 1.06M4.64 11.36l-1.06 1.06" />
      </svg>
    );
  }
  if (mode === "dark") {
    return (
      <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M13.2 9.8A5.5 5.5 0 0 1 6.2 2.8a5.5 5.5 0 1 0 7 7Z" />
      </svg>
    );
  }
  return (
    <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="2" y="2.75" width="12" height="8.5" rx="1.5" />
      <path d="M5.5 13.5h5M8 11.25v2.25" />
    </svg>
  );
}

function LanguageMenu() {
  const { t, lang } = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={root} class="relative">
      {/* Native <select> kept visually hidden for screen-reader/automated selectOption compatibility */}
      <label class="sr-only" for="pp-lang">
        {t("app.language")}
      </label>
      <select
        id="pp-lang"
        tabIndex={-1}
        class="sr-only"
        value={lang}
        onChange={(e) => setLanguage((e.currentTarget as HTMLSelectElement).value as (typeof LANGUAGES)[number]["code"])}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("app.language")}
        class={cx(
          "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors",
          open
            ? "border-accent/60 bg-well/70 text-ink"
            : "border-rule bg-sheet text-ink-soft hover:border-rule-strong hover:bg-well/50 hover:text-ink",
        )}
        onClick={() => setOpen((v) => !v)}
      >
        <svg class="h-3.5 w-3.5 shrink-0 text-ink-faint" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="8" cy="8" r="6" />
          <path d="M2.2 8h11.6M8 2a9.2 9.2 0 0 1 2.4 6A9.2 9.2 0 0 1 8 14a9.2 9.2 0 0 1-2.4-6A9.2 9.2 0 0 1 8 2Z" />
        </svg>
        <span class="uppercase tracking-wide">{lang}</span>
        <svg
          class={cx("h-3 w-3 shrink-0 text-ink-faint transition-transform duration-150", open && "rotate-180")}
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
      </button>

      {open && (
        <div
          role="menu"
          class="pp-pop absolute top-full right-0 z-30 mt-1.5 min-w-36 origin-top-right rounded-xl border border-rule bg-sheet p-1 shadow-[0_10px_28px_-6px_rgb(15_23_42/0.16),0_2px_6px_-2px_rgb(15_23_42/0.06)] dark:shadow-[0_12px_32px_-6px_rgb(0_0_0/0.55)]"
        >
          {LANGUAGES.map((l) => {
            const active = l.code === lang;
            return (
              <button
                key={l.code}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                lang={l.code}
                class={cx(
                  "flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
                  active ? "bg-accent-wash/75 font-semibold text-accent-ink" : "font-medium text-ink hover:bg-well",
                )}
                onClick={() => {
                  setLanguage(l.code);
                  setOpen(false);
                }}
              >
                <span>{l.label}</span>
                {active ? (
                  <svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
                  </svg>
                ) : (
                  <span class="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{l.code}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PrimaryNav({ view, onView, dotClass }: { view: View; onView: (v: View) => void; dotClass: string | null }) {
  const { t, lang } = useT();
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number; ready: boolean }>({ left: 0, width: 0, ready: false });

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) return;
      setPill((prev) => ({ left: active.offsetLeft, width: active.offsetWidth, ready: prev.width > 0 }));
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(nav);
    return () => ro?.disconnect();
  }, [view, lang]);

  return (
    <nav ref={navRef} class="relative order-last flex w-full gap-1 overflow-x-auto rounded-xl bg-well/80 p-1 md:order-none md:w-auto" aria-label={t("app.name")}>
      {pill.width > 0 && (
        <span
          aria-hidden="true"
          class={cx(
            "pointer-events-none absolute top-1 bottom-1 left-0 rounded-lg bg-sheet shadow-[0_1px_2px_rgb(15_23_42/0.08)] ring-1 ring-black/5 dark:ring-white/10",
            pill.ready && "transition-[transform,width] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)]",
          )}
          style={{ width: `${pill.width}px`, transform: `translateX(${pill.left}px)` }}
        />
      )}
      {VIEWS.map((v) => {
        const active = view === v;
        return (
          <a
            key={v}
            href={`#/${v}`}
            aria-current={active ? "page" : undefined}
            class={cx(
              "relative z-10 inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm no-underline transition-colors duration-150 md:flex-initial",
              active ? "font-semibold text-ink" : "font-medium text-ink-soft hover:text-ink",
            )}
            onClick={(e) => {
              e.preventDefault();
              onView(v);
            }}
          >
            <NavIcon view={v} />
            {t(`nav.${v}`)}
            {v === "status" && dotClass && <span class={cx("h-1.5 w-1.5 rounded-full", dotClass)} aria-hidden="true" />}
          </a>
        );
      })}
    </nav>
  );
}

function Header({ view, onView }: { view: View; onView: (v: View) => void }) {
  const { t, lang } = useT();
  const { status, queue } = usePrinter();
  const [theme, setTheme] = useTheme();
  // Mailbox retrievals also show up as running jobs; only real printing counts here.
  const printing = Boolean(queue.data?.some((j) => j.state === "printing" && j.type !== "mailboxRetrieval"));
  const offline = status.error instanceof PrinterUnreachableError && !status.data;
  const { state, severity } = effectiveState(status.data, printing, offline);
  const low = status.data ? lowToners(status.data.supplies) : [];
  const listFormat = new Intl.ListFormat(lang, { style: "short", type: "conjunction" });
  // Almost empty (red) first, then the printer's own "running low" warnings.
  const urgent = low.filter((s) => s.severity === "error");
  const notUrgent = low.filter((s) => s.severity !== "error");
  const colors = (list: typeof low) => listFormat.format(list.map((s) => t(`supplies.color.${s.color ?? "black"}`)));
  const tonerSummary = [urgent.length ? t("supplies.urgentSummary", { colors: colors(urgent) }) : "", notUrgent.length ? t("supplies.lowSummary", { colors: colors(notUrgent) }) : ""]
    .filter(Boolean)
    .join(lang === "ja" ? "　" : ". ");
  const themeIndex = Math.max(0, THEMES.indexOf(theme));

  return (
    <header class="sticky top-0 z-20 border-b border-rule/80 bg-sheet/88 backdrop-blur-md">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2.5 px-4 py-2.5 sm:px-6">
        {/* Left: Brand & Device */}
        <div class="flex min-w-0 items-center gap-2.5">
          <BrandMark />
          <div class="flex min-w-0 flex-col">
            <div class="flex items-center gap-2">
              <h1 class="m-0 text-[15px] leading-tight font-bold tracking-tight text-ink sm:text-base">{t("app.name")}</h1>
              <DeviceBadge state={state} severity={severity} />
            </div>
            {status.data?.device.model && (
              <span class="hidden truncate text-[11px] leading-tight text-ink-faint sm:block">{status.data.device.model}</span>
            )}
          </div>
        </div>

        {/* Center: Primary Navigation with sliding pill */}
        <PrimaryNav view={view} onView={onView} dotClass={low.length > 0 ? (urgent.length ? "bg-error" : "bg-warn") : null} />

        {/* Right: Compact Icon Controls (Language + Sliding Theme Switcher) */}
        <div class="flex items-center gap-2">
          <LanguageMenu />

          {/* 3-way Icon Theme Switcher with sliding thumb */}
          <div class="relative inline-grid grid-cols-3 items-center rounded-lg border border-rule/80 bg-well/80 p-0.5" role="group" aria-label={t("app.theme.label")}>
            <span
              aria-hidden="true"
              data-theme-thumb
              class="pointer-events-none absolute top-0.5 left-0.5 h-7 w-7 rounded-md bg-sheet shadow-[0_1px_2px_rgb(15_23_42/0.08)] ring-1 ring-black/5 transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] dark:ring-white/10"
              style={{ transform: `translateX(${themeIndex * 100}%)` }}
            />
            {THEMES.map((mode) => {
              const active = theme === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={active}
                  aria-label={t(`app.theme.${mode}`)}
                  title={t(`app.theme.${mode}`)}
                  class={cx(
                    "relative z-10 grid h-7 w-7 cursor-pointer place-items-center rounded-md transition-colors duration-150",
                    active ? "text-ink" : "text-ink-faint hover:text-ink",
                  )}
                  onClick={() => setTheme(mode)}
                >
                  <ThemeIcon mode={mode} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Slim contextual alert strip when toner is low — keeps the header clean and balanced */}
      {low.length > 0 && view !== "status" && (
        <div class={cx("border-t", urgent.length ? "border-error/25 bg-error-wash/80" : "border-warn/20 bg-warn-wash/75")}>
          <div class="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-1.5 text-xs sm:px-6">
            <button
              type="button"
              class={cx("inline-flex cursor-pointer items-center gap-1.5 text-left font-medium transition-opacity hover:opacity-80", urgent.length ? "text-error" : "text-warn")}
              onClick={() => onView("status")}
            >
              <svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.2 9.1A1 1 0 0 1 13.2 13H2.8a1 1 0 0 1-.87-1.4l5.2-9.1ZM8 5.5a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8 5.5Zm0 6a.85.85 0 1 0 0-1.7.85.85 0 0 0 0 1.7Z" />
              </svg>
              <span>{tonerSummary}</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      )}
    </header>
  );
}

function Shell() {
  const { t } = useT();
  const [view, setView] = useView();
  const prevView = useRef<View>(view);
  const dir = useRef<"right" | "left" | null>(null);
  if (prevView.current !== view) {
    dir.current = VIEWS.indexOf(view) > VIEWS.indexOf(prevView.current) ? "right" : "left";
    prevView.current = view;
  }
  const jobsLink = hashName() === "jobs";
  const slideClass = dir.current === "right" ? "pp-slide-right" : dir.current === "left" ? "pp-slide-left" : undefined;
  return (
    <div class="flex min-h-screen flex-col">
      <Header view={view} onView={setView} />
      <main class="mx-auto w-full max-w-6xl flex-1 overflow-x-clip px-4 py-6 sm:px-6 sm:py-7">
        <div key={view} class={slideClass}>
          {view === "print" && <PrintPage />}
          {view === "mailbox" && <MailboxPage />}
          {view === "status" && <StatusPage showHistory={jobsLink} />}
        </div>
      </main>
      <footer class="mx-auto flex w-full max-w-6xl items-center justify-between border-t border-rule/70 px-4 py-4 text-xs text-ink-faint sm:px-6">
        <button
          type="button"
          class="cursor-pointer rounded-lg px-2 py-1 font-medium text-ink-soft transition-colors hover:bg-well hover:text-ink"
          title={t("app.classicUiHint")}
          onClick={() => location.reload()}
        >
          {t("app.classicUi")}
        </button>
        <span class="tabular rounded-md bg-well/70 px-2 py-0.5 font-medium text-ink-faint">v{__PORTAL_VERSION__} ({__BUILD_ID__.slice(0, 7)})</span>
      </footer>
    </div>
  );
}

export function App(props: { client?: PrinterClient }) {
  return (
    <PrinterProvider client={props.client}>
      <SubmissionsProvider>
        <MailboxProvider>
          <Shell />
        </MailboxProvider>
      </SubmissionsProvider>
    </PrinterProvider>
  );
}
