import { useEffect, useState } from "preact/hooks";
import { LANGUAGES, setLanguage, useT } from "../i18n";
import type { PrinterClient } from "../printer/client";
import { PrinterUnreachableError } from "../printer/client";
import { cx } from "./components/controls";
import { DeviceBadge, effectiveState, lowToners } from "./components/status";
import { JobsPage } from "./pages/JobsPage";
import { PrintPage } from "./pages/PrintPage";
import { StatusPage } from "./pages/StatusPage";
import { PrinterProvider, usePrinter } from "./PrinterContext";
import { type Theme, applyTheme, loadTheme, saveTheme } from "./settings";

type View = "print" | "jobs" | "status";
const VIEWS: View[] = ["print", "jobs", "status"];

/** Keep the current view in the URL hash so the back button works inside the app. */
function viewFromHash(): View {
  const v = location.hash.replace(/^#\/?/, "");
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
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq?.addEventListener("change", onChange);
    return () => mq?.removeEventListener("change", onChange);
  }, [theme]);
  return [
    theme,
    (t) => {
      saveTheme(t);
      setTheme(t);
    },
  ];
}

function Header({ view, onView }: { view: View; onView: (v: View) => void }) {
  const { t, lang } = useT();
  const { status, queue } = usePrinter();
  const [theme, setTheme] = useTheme();
  const printing = Boolean(queue.data?.some((j) => j.state === "printing"));
  const offline = status.error instanceof PrinterUnreachableError && !status.data;
  const { state, severity } = effectiveState(status.data, printing, offline);
  const low = status.data ? lowToners(status.data.supplies) : [];
  const listFormat = new Intl.ListFormat(lang, { style: "short", type: "conjunction" });

  return (
    <header class="border-b border-rule bg-sheet">
      <div class="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <div class="flex min-w-0 items-baseline gap-3">
          <h1 class="m-0 text-lg font-bold tracking-tight">{t("app.name")}</h1>
          {status.data?.device.model && <span class="hidden text-sm text-ink-faint md:inline">{status.data.device.model}</span>}
        </div>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
          <DeviceBadge state={state} severity={severity} />
          {low.length > 0 && (
            <button type="button" class="text-sm text-warn underline decoration-dotted underline-offset-4" onClick={() => onView("status")}>
              {t("supplies.lowSummary", { colors: listFormat.format(low.map((s) => t(`supplies.color.${s.color ?? "black"}`))) })}
            </button>
          )}
        </div>
        <div class="ml-auto flex items-center gap-2">
          <label class="sr-only" for="pp-lang">
            {t("app.language")}
          </label>
          <select
            id="pp-lang"
            class="rounded-lg border border-rule bg-sheet px-2 py-1 text-sm text-ink"
            value={lang}
            onChange={(e) => setLanguage((e.currentTarget as HTMLSelectElement).value as (typeof LANGUAGES)[number]["code"])}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code} lang={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <label class="sr-only" for="pp-theme">
            {t("app.theme.label")}
          </label>
          <select id="pp-theme" class="rounded-lg border border-rule bg-sheet px-2 py-1 text-sm text-ink" value={theme} onChange={(e) => setTheme((e.currentTarget as HTMLSelectElement).value as Theme)}>
            {(["system", "light", "dark"] as const).map((v) => (
              <option key={v} value={v}>
                {t(`app.theme.${v}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <nav class="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2 sm:px-4" aria-label={t("app.name")}>
        {VIEWS.map((v) => (
          <a
            key={v}
            href={`#/${v}`}
            aria-current={view === v ? "page" : undefined}
            class={cx(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm no-underline",
              view === v ? "border-accent font-bold text-ink" : "border-transparent text-ink-soft hover:text-ink",
            )}
            onClick={(e) => {
              e.preventDefault();
              onView(v);
            }}
          >
            {t(`nav.${v}`)}
          </a>
        ))}
      </nav>
    </header>
  );
}

function Shell() {
  const { t } = useT();
  const [view, setView] = useView();
  return (
    <div class="flex min-h-screen flex-col">
      <Header view={view} onView={setView} />
      <main class="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        {view === "print" && <PrintPage />}
        {view === "jobs" && <JobsPage />}
        {view === "status" && <StatusPage />}
      </main>
      <footer class="mx-auto w-full max-w-7xl px-4 pb-6 text-xs text-ink-faint sm:px-6">
        <button type="button" class="rounded px-1 py-0.5 text-ink-soft underline underline-offset-4 hover:text-ink" title={t("app.classicUiHint")} onClick={() => location.reload()}>
          {t("app.classicUi")}
        </button>
        <span class="ml-3">v{__PORTAL_VERSION__}</span>
      </footer>
    </div>
  );
}

export function App(props: { client?: PrinterClient }) {
  return (
    <PrinterProvider client={props.client}>
      <Shell />
    </PrinterProvider>
  );
}
