import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

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
  await expect(page.getByText("A4に白黒で両面（長辺とじ）、各ファイル1部ずつ印刷します。")).toBeVisible();

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
  await expect(page.getByText("この形式は直接印刷できません。PDF に書き出してから追加してください。")).toBeVisible();
  await expect(page.getByRole("button", { name: "印刷", exact: true })).toBeDisabled();
});

test("switches language instantly and remembers it", async ({ page }) => {
  await openPortal(page);
  await page.getByLabel("表示言語").selectOption("en");
  await expect(page.getByRole("link", { name: "Mailbox" })).toBeVisible();
  await expect(page.getByText("1 copy of each file, 2-sided (long edge), in black & white on A4.")).toBeVisible();
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
