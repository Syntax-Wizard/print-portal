// Bookmarklet source. Built into a `javascript:` URL by scripts/build-site.ts, which
// replaces __PORTAL_BASE_URL__. Keep it tiny and dependency-free: it runs in the
// printer's old page, before any of our code is loaded.
(function () {
  if (window.__printPortal) return;
  var ja = /^ja\b/i.test(navigator.language || "");
  var onPrinter = typeof window.jtPath === "string" || /Internet Services/i.test(document.title);
  if (!onPrinter) {
    alert(
      ja
        ? "プリンターのページ（例: http://<プリンターのアドレス>/）を開いてから、もう一度クリックしてください。"
        : "Open the printer's page (e.g. http://<printer address>/) first, then click this bookmark again.",
    );
    return;
  }
  var s = document.createElement("script");
  // Cache-bust hourly so updates arrive quickly without re-downloading on every click.
  s.src = "__PORTAL_BASE_URL__portal.js?h=" + Math.floor(Date.now() / 3600000);
  s.onerror = function () {
    alert(
      ja
        ? "Tombo を読み込めませんでした。インターネットに接続されているか確認してください。元の画面はそのまま使えます。"
        : "Couldn't load Tombo. Check your internet connection. The original screen still works.",
    );
  };
  (document.head || document.documentElement).appendChild(s);
})();
