import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, PDFName, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from "pdf-lib";

const bookmarklet = readFileSync(fileURLToPath(new URL("../dist/bookmarklet.txt", import.meta.url)), "utf-8").trim();
// The bookmarklet may be built for the real GitHub Pages URL (as in CI, before deployment).
// Point it at the bundle just built and served by the mock printer, so tests always cover this build.
const bookmarkletCode = decodeURIComponent(bookmarklet.replace(/^javascript:/, "")).replace(
  /(["'])https?:\/\/[^"']*portal\.js\?h=\1/,
  '"http://localhost:8631/__portal/portal.js?h="',
);
if (!bookmarkletCode.includes("http://localhost:8631/__portal/portal.js")) throw new Error("Could not retarget the bookmarklet");
const samplePdf = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj\n2 0 obj<</Type /Pages /Kids [3 0 R] /Count 1>>endobj\n3 0 obj<</Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

const tonerSnapshot = JSON.parse(readFileSync(fileURLToPath(new URL("../mock-printer/fixtures/toner.json", import.meta.url)), "utf-8"));

/** Open the (mock) printer and "click" the bookmarklet, exactly as a user would. */
async function openPortal(page: Page) {
  // Serve the exact-toner snapshot locally, whatever URL this build points at.
  await page.route("**/toner.json", (route) =>
    route.fulfill({
      json: { ...tonerSnapshot, measuredAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
      headers: { "Access-Control-Allow-Origin": "*" },
    }),
  );
  await page.goto("/print.htm");
  await page.evaluate(bookmarkletCode);
  await expect(page.getByRole("heading", { name: "Print Portal" })).toBeVisible();
}

test("bookmarklet takes over the printer page in standards mode", async ({ page }) => {
  await openPortal(page);
  expect(await page.evaluate(() => document.compatMode)).toBe("CSS1Compat");
  expect(await page.title()).toBe("Print Portal");
  expect(await page.locator("frameset").count()).toBe(0);
  await expect(page.getByText("ApeosPort-V C4476")).toBeVisible();
  await expect(page.getByText("節電中")).toBeVisible();
});

test("a second click does not reload the portal", async ({ page }) => {
  await openPortal(page);
  await page.evaluate(bookmarkletCode);
  await expect(page.locator("#app")).toHaveCount(1);
});

test("bookmarklet explains itself on a non-printer page", async ({ page }) => {
  await page.goto("/__portal/index.html");
  const dialog = page.waitForEvent("dialog");
  void page.evaluate(bookmarkletCode);
  const d = await dialog;
  expect(d.message()).toContain("プリンターのページ");
  await d.dismiss();
});

test("prints a file with the lab defaults and follows the job to completion", async ({ page }) => {
  await openPortal(page);
  await expect(page.getByText("A4にカラー自動判別で両面（長辺とじ）、各ファイル1部ずつ印刷します。")).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: samplePdf });
  await expect(page.getByText("report.pdf")).toBeVisible();
  await page.getByRole("button", { name: "1 ファイルを印刷" }).click();

  await expect(page.getByText(/送信中|プリンターに送信しました|プリンターで待機中/).first()).toBeVisible();
  await expect(page.getByText("印刷しました")).toBeVisible({ timeout: 20_000 });

  // The job is now recognised as "mine" in the (collapsed) history on the status page.
  await page.getByRole("link", { name: "プリンター状態" }).click();
  await page.getByText("最近のジョブ").click();
  await expect(page.getByText("自分").first()).toBeVisible({ timeout: 10_000 });
});

test("rejects unsupported files before sending", async ({ page }) => {
  await openPortal(page);
  await page.locator('input[type="file"]').setInputFiles({ name: "paper.docx", mimeType: "application/msword", buffer: Buffer.from("x") });
  await expect(page.getByText("この形式は直接印刷できません。PDF に書き出すか、画像として保存してから追加してください。")).toBeVisible();
  await expect(page.getByRole("button", { name: "印刷", exact: true })).toBeDisabled();
});

test("switches language instantly and remembers it", async ({ page }) => {
  await openPortal(page);
  await page.getByLabel("表示言語").selectOption("en");
  await expect(page.getByRole("link", { name: "Mailbox" })).toBeVisible();
  await expect(page.getByText("1 copy of each file, 2-sided (long edge), in auto color on A4.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");

  await page.reload();
  await page.evaluate(bookmarkletCode);
  await expect(page.getByRole("link", { name: "Mailbox" })).toBeVisible();
});

test("secure print needs a user ID and numeric passcode", async ({ page }) => {
  await openPortal(page);
  await page.getByText("詳細設定").click();
  await page.getByText("セキュリティープリント", { exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "grades.pdf", mimeType: "application/pdf", buffer: samplePdf });
  await page.getByRole("button", { name: "1 ファイルを印刷" }).click();
  await expect(page.getByText("ユーザーIDを入力してください。")).toBeVisible();
  await expect(page.getByText("暗証番号は数字 1〜12 桁で入力してください。")).toBeVisible();
});

test("status and jobs pages render printer data", async ({ page }) => {
  await openPortal(page);
  await page.getByRole("link", { name: "プリンター状態" }).click();
  await expect(page.getByRole("heading", { name: "エラー履歴" })).toBeVisible();
  await expect(page.getByText("016-788").first()).toBeVisible();
  await expect(page.getByText("ドラムカートリッジ")).toBeVisible();
  // Job history is folded into the status page and loads when expanded.
  await expect(page.getByRole("table")).toHaveCount(1); // error log only
  await page.getByText("最近のジョブ").click();
  await expect(page.getByRole("columnheader", { name: "完了時刻" })).toBeVisible();
});

test("old #/jobs links open the status page with the history expanded", async ({ page }) => {
  await openPortal(page);
  await page.evaluate(() => (location.hash = "/jobs"));
  await expect(page.getByRole("columnheader", { name: "完了時刻" })).toBeVisible();
});

test("shows exact toner levels from the published snapshot", async ({ page }) => {
  await openPortal(page);
  await page.getByRole("link", { name: "プリンター状態" }).click();
  await expect(page.getByText("正確な値は3 時間前に測定したものです。")).toBeVisible();
  // Yellow and magenta: 1% measured, inside the live 1–25% range.
  await expect(page.getByRole("meter", { name: "イエロー 1%" })).toBeVisible();
  await expect(page.getByRole("meter", { name: "マゼンタ 1%" })).toBeVisible();
  // An alert only SNMP reports (the web page shows none), with a translated category.
  await expect(page.getByText("094-421")).toBeVisible();
  await expect(page.getByText("3 時間前に SNMP で取得した情報です。").first()).toBeVisible();
});

test("mailbox: unlock, save, see new scans, delete, remember my box", async ({ page, request }) => {
  await openPortal(page);
  await page.getByRole("link", { name: "ボックス" }).click();
  await page.getByRole("button", { name: /^027\s*test$/ }).click();

  // Wrong password first, then the right one (the mock printer uses 1234).
  await page.getByLabel("パスワード").fill("0000");
  await page.getByRole("button", { name: "開く", exact: true }).click();
  await expect(page.getByText("パスワードが違います。")).toBeVisible();
  await page.getByLabel("パスワード").fill("1234");
  await page.getByRole("button", { name: "開く", exact: true }).click();
  await expect(page.getByText("2 件の文書")).toBeVisible();
  await expect(page.getByText("2 ページ")).toBeVisible();

  // The password never reaches persistent storage.
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).not.toContain("1234");
  expect(stored).not.toContain("FAKETOKEN");

  // Save one document as PDF.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).first().click();
  expect((await download).suggestedFilename()).toMatch(/^\d{14}\.pdf$/);
  await expect(page.getByText("1 件を保存しました。")).toBeVisible();

  // Someone scans into the box on the printer: the list updates on its own.
  await request.post("/__mock/scan?box=27");
  await expect(page.getByText("3 件の文書")).toBeVisible({ timeout: 15_000 });

  // Delete one document after confirming.
  await page.getByRole("checkbox").nth(1).check();
  await page.getByRole("button", { name: "選択した 1 件を削除" }).click();
  await page.getByRole("button", { name: "削除する" }).click();
  await expect(page.getByText("1 件を削除しました。")).toBeVisible();
  await expect(page.getByText("2 件の文書")).toBeVisible();

  // Remember this box: next time the page goes straight to its password.
  await page.getByRole("button", { name: "自分のボックスにする" }).click();
  await page.reload();
  await page.evaluate(bookmarkletCode);
  await page.getByRole("link", { name: "ボックス" }).click();
  await expect(page.getByLabel("パスワード")).toBeVisible();
  await expect(page.getByRole("heading", { name: "test" })).toBeVisible();
});

async function multiPagePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= pages; i++) doc.addPage([595, 842]).drawText(`Page ${i}`, { x: 50, y: 780, size: 32 });
  return Buffer.from(await doc.save());
}

test("PDF: count pages, select pages, 2 per sheet, preview and send the processed file", async ({ page, request }) => {
  await openPortal(page);
  await page.locator('input[type="file"]').setInputFiles({ name: "thesis.pdf", mimeType: "application/pdf", buffer: await multiPagePdf(5) });
  await expect(page.getByText("全 5 ページ")).toBeVisible(); // loads pdf-tools.js on demand
  // 5 pages, 2-sided: 3 sheets.
  await expect(page.getByText("用紙は約 3 枚です。")).toBeVisible();

  // An invalid selection blocks printing.
  await page.getByLabel("印刷するページ").fill("2-9");
  await expect(page.getByText("このファイルは 5 ページまでです。")).toBeVisible();
  await expect(page.getByRole("button", { name: "1 ファイルを印刷" })).toBeDisabled();

  // Pages 2-4, two per sheet: 2 sheet sides, 1 sheet of paper when 2-sided.
  await page.getByLabel("印刷するページ").fill("2-4");
  await page.getByText("2 ページ", { exact: true }).click();
  await expect(page.getByText("用紙は約 1 枚です。")).toBeVisible();

  // The preview shows the processed PDF in the browser's viewer.
  await page.getByRole("button", { name: "仕上がりを確認" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").locator("iframe")).toHaveAttribute("src", /^blob:/);
  await page.getByRole("button", { name: "閉じる" }).click();

  await page.getByRole("button", { name: "1 ファイルを印刷" }).click();
  // Wait on this file's own row (the queue panel may also say 印刷中 for other jobs).
  await expect(page.locator("li", { hasText: "thesis.pdf" }).getByText(/プリンターに送信しました|プリンターで待機中|印刷中|印刷しました/)).toBeVisible({ timeout: 15_000 });
  const upload = await (await request.get("/__mock/last-upload")).json();
  expect(upload.name).toBe("thesis.pdf");
  expect(upload.pages).toBe(2); // 3 selected pages, 2 per sheet
  expect(upload.firstPageSize).toEqual([842, 595]); // landscape A4
  // "Long edge" was chosen; for landscape 2-up sheets the printer needs short edge to turn like a book.
  expect(upload.fields.DUP).toBe("TB");
});

test("PDF: files that need no change are sent untouched", async ({ page, request }) => {
  await openPortal(page);
  const original = await multiPagePdf(3);
  await page.locator('input[type="file"]').setInputFiles({ name: "plain.pdf", mimeType: "application/pdf", buffer: original });
  await expect(page.getByText("全 3 ページ")).toBeVisible();
  await page.getByRole("button", { name: "1 ファイルを印刷" }).click();
  await expect(page.locator("li", { hasText: "plain.pdf" }).getByText(/プリンターに送信しました|プリンターで待機中|印刷中|印刷しました/)).toBeVisible({ timeout: 15_000 });
  const upload = await (await request.get("/__mock/last-upload")).json();
  expect(upload.name).toBe("plain.pdf");
  expect(upload.size).toBe(original.length);
});

test("asks before leaving while files are waiting, and offers the preview in a new tab", async ({ page }) => {
  await openPortal(page);
  await page.locator('input[type="file"]').setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: await multiPagePdf(4) });
  await expect(page.getByText("全 4 ページ")).toBeVisible();

  await page.getByLabel("印刷するページ").fill("4");
  await page.getByRole("button", { name: "仕上がりを確認" }).click();
  await expect(page.getByRole("link", { name: "新しいタブで開く" })).toHaveAttribute("href", /^blob:/);
  await page.getByRole("button", { name: "閉じる" }).click();

  const dialog = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  const d = await dialog;
  expect(d.type()).toBe("beforeunload");
  await d.dismiss();
});

test("an outdated pdf-tools.js from the browser cache is refused, never used", async ({ page, request }) => {
  // Simulate the cache mismatch seen right after a release: an older tools bundle whose
  // preparePdf returned raw bytes instead of { bytes, landscape }.
  await page.route("**/pdf-tools.js*", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "window.PrintPortalPdf={apiVersion:1,countPages:async()=>4,preparePdf:async()=>new Uint8Array([1,2,3])};",
    }),
  );
  await openPortal(page);
  const before = await (await request.get("/__mock/last-upload")).json();
  await page.locator('input[type="file"]').setInputFiles({ name: "stale.pdf", mimeType: "application/pdf", buffer: await multiPagePdf(4) });
  await expect(page.getByText("新しいバージョンに更新されました。ページを再読み込みしてから、もう一度ブックマークをクリックしてください。")).toBeVisible();
  // With 2 pages per sheet chosen, the file must not be sent 1-up as if nothing happened.
  await page.getByText("2 ページ", { exact: true }).click();
  await page.getByRole("button", { name: "1 ファイルを印刷" }).first().click();
  await expect(page.locator("li", { hasText: "stale.pdf" }).getByText("印刷できませんでした")).toBeVisible();
  expect(await (await request.get("/__mock/last-upload")).json()).toEqual(before);
});

test("printing a few pages of a large PDF uploads only those pages", async ({ page, request }) => {
  // 20 pages of ~300 KB images, all listed in one shared Resources dict (common in real files).
  const doc = await PDFDocument.create();
  const xobjects = doc.context.obj({});
  for (let i = 0; i < 20; i++) {
    const raw = new Uint8Array(300_000).map((_, k) => (k * 31 + i * 17) % 251);
    xobjects.set(PDFName.of(`Im${i}`), doc.context.register(doc.context.stream(raw, { Type: "XObject", Subtype: "Image", Width: 100, Height: 1000, ColorSpace: "DeviceRGB", BitsPerComponent: 8 })));
    const p = doc.addPage([595, 842]);
    p.pushOperators(pushGraphicsState(), concatTransformationMatrix(300, 0, 0, 300, 100, 300), drawObject(`Im${i}`), popGraphicsState());
    p.node.delete(PDFName.of("Resources"));
  }
  doc.catalog.Pages().set(PDFName.of("Resources"), doc.context.obj({ XObject: xobjects }));
  const big = Buffer.from(await doc.save({ useObjectStreams: false }));

  await openPortal(page);
  await page.locator('input[type="file"]').setInputFiles({ name: "large.pdf", mimeType: "application/pdf", buffer: big });
  await expect(page.getByText("全 20 ページ")).toBeVisible();
  await page.getByLabel("印刷するページ").fill("3");
  await page.getByRole("button", { name: "1 ファイルを印刷" }).first().click();
  await expect(page.locator("li", { hasText: "large.pdf" }).getByText(/プリンターに送信しました|プリンターで待機中|印刷中|印刷しました/)).toBeVisible({ timeout: 15_000 });
  const upload = await (await request.get("/__mock/last-upload")).json();
  expect(upload.name).toBe("large.pdf");
  expect(upload.pages).toBe(1);
  expect(upload.size).toBeLessThan(big.length / 10);
});

test("mailbox: thumbnails, preview and local display names", async ({ page }) => {
  await openPortal(page);
  await page.getByRole("link", { name: "ボックス" }).click();
  await page.getByRole("button", { name: /^027\s*test$/ }).click();
  await page.getByLabel("パスワード").fill("1234");
  await page.getByRole("button", { name: "開く", exact: true }).click();
  await expect(page.getByText(/件の文書/)).toBeVisible();

  // Thumbnails are rendered with pdf.js (loaded on demand, worker from a blob: URL).
  const firstRow = page.locator("li").filter({ has: page.getByRole("button", { name: "表示" }) }).first();
  const thumb = firstRow.locator("img");
  await expect(thumb).toHaveAttribute("src", /^data:image\/png/, { timeout: 20_000 });
  // The mock documents are CCITT G4 black & white scans like the printer's. pdf.js needs its
  // WebAssembly decoders for those; without them the thumbnail is a blank white page.
  const darkPercent = await thumb.evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]! < 160) dark++;
    return (100 * dark) / (d.length / 4);
  });
  expect(darkPercent).toBeGreaterThan(3);

  // Clicking the thumbnail opens the whole document.
  await firstRow.getByRole("button", { name: /1 ページ目/ }).click();
  await expect(page.getByRole("dialog").locator("iframe")).toHaveAttribute("src", /^blob:/);
  await page.getByRole("dialog").getByRole("button", { name: "閉じる" }).click();

  // Give it a name: shown instead of the timestamp and used for the downloaded file.
  await firstRow.getByRole("button", { name: "名前を付ける" }).click();
  await page.getByLabel("表示名").fill("ゼミ資料: 第3回");
  await page.getByRole("button", { name: "決定" }).click();
  await expect(page.getByText("ゼミ資料: 第3回")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.locator("li", { hasText: "ゼミ資料: 第3回" }).getByRole("button", { name: "保存", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("ゼミ資料_ 第3回.pdf");

  // Names survive a reload (kept in this browser), the password does not.
  await page.reload();
  await page.evaluate(bookmarkletCode);
  await page.getByRole("link", { name: "ボックス" }).click();
  await page.getByRole("button", { name: /^027\s*test$/ }).click();
  await page.getByLabel("パスワード").fill("1234");
  await page.getByRole("button", { name: "開く", exact: true }).click();
  await expect(page.getByText("ゼミ資料: 第3回")).toBeVisible();
});

test("an outdated cached portal.js switches to the current build before starting", async ({ page }) => {
  const portal = readFileSync(fileURLToPath(new URL("../dist/portal.js", import.meta.url)), "utf-8");
  const requested: string[] = [];
  page.on("request", (r) => r.url().includes("portal.js") && requested.push(new URL(r.url()).search));
  // Pretend a newer build has been released since this portal.js was cached.
  await page.route("**/version.json*", (route) => route.fulfill({ json: { buildId: "newer-build" } }));
  await page.route("**/portal.js?b=newer-build", (route) => route.fulfill({ contentType: "text/javascript", body: portal }));
  await openPortal(page);
  expect(requested).toContain("?b=newer-build");
  expect(requested.filter((q) => q === "?b=newer-build")).toHaveLength(1); // no loop
  await expect(page.getByText(/^v\d+\.\d+\.\d+ \([0-9a-f-]+/)).toBeVisible(); // build shown in the footer
});

/** Make an image in the page (real browser encoders), returned as bytes for setInputFiles. */
async function canvasImage(page: Page, type: "image/png" | "image/jpeg", width: number, height: number, exifOrientation?: number): Promise<Buffer> {
  const bytes = await page.evaluate(
    async ({ type, width, height, exifOrientation }) => {
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#c00";
      ctx.fillRect(0, 0, width / 2, height / 4); // a marker in the top-left corner
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), type, 0.9));
      let out = new Uint8Array(await blob.arrayBuffer());
      if (exifOrientation) {
        // Insert an APP1 Exif segment with the Orientation tag right after SOI.
        const tiff = new Uint8Array([0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, exifOrientation, 0, 0, 0, 0, 0, 0, 0]);
        const body = new Uint8Array([...new TextEncoder().encode("Exif"), 0, 0, ...tiff]);
        const app1 = new Uint8Array([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]);
        out = new Uint8Array([...out.subarray(0, 2), ...app1, ...out.subarray(2)]);
      }
      return [...out];
    },
    { type, width, height, exifOrientation },
  );
  return Buffer.from(bytes);
}

async function printAndInspect(page: Page, request: import("@playwright/test").APIRequestContext, name: string) {
  await page.getByRole("button", { name: "1 ファイルを印刷" }).first().click();
  await expect(page.locator("li", { hasText: name }).getByText(/プリンターに送信しました|プリンターで待機中|印刷中|印刷しました/)).toBeVisible({ timeout: 15_000 });
  return (await request.get("/__mock/last-upload")).json();
}

test("images: a landscape PNG is printed as a landscape PDF page", async ({ page, request }) => {
  await openPortal(page);
  const png = await canvasImage(page, "image/png", 800, 400);
  await page.locator('input[type="file"]').setInputFiles({ name: "chart.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("li", { hasText: "chart.png" }).getByRole("button", { name: "仕上がりを確認" })).toBeVisible();
  const upload = await printAndInspect(page, request, "chart.png");
  expect(upload.name).toBe("chart.pdf");
  expect(upload.pages).toBe(1);
  expect(upload.firstPageSize).toEqual([842, 595]);
});

test("images: a phone photo with EXIF rotation prints upright", async ({ page, request }) => {
  await openPortal(page);
  // Stored 600x300 but tagged "rotate 90°": displayed (and printed) as a 300x600 portrait photo.
  const jpeg = await canvasImage(page, "image/jpeg", 600, 300, 6);
  await page.locator('input[type="file"]').setInputFiles({ name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: jpeg });
  const upload = await printAndInspect(page, request, "IMG_0001.jpg");
  expect(upload.name).toBe("IMG_0001.pdf");
  expect(upload.firstPageSize).toEqual([595, 842]);
});

test("images: paste a screenshot with Ctrl+V", async ({ page }) => {
  await openPortal(page);
  const png = await canvasImage(page, "image/png", 320, 200);
  await page.evaluate((bytes) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], "image.png", { type: "image/png" }));
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  }, [...png]);
  await expect(page.getByText(/^screenshot-\d{8}-\d{6}\.png$/)).toBeVisible();
  await expect(page.locator("li", { hasText: "screenshot-" })).toHaveCount(1);
});

test("images: one the browser cannot decode is flagged right away", async ({ page }) => {
  await openPortal(page);
  await page.locator('input[type="file"]').setInputFiles({ name: "IMG_0002.HEIC", mimeType: "image/heic", buffer: Buffer.from("not really heic") });
  await expect(page.getByText(/このブラウザーではこの画像を読み込めません/)).toBeVisible();
});
