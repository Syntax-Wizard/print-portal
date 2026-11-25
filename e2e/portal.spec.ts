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

/** Open the (mock) printer and "click" the bookmarklet, exactly as a user would. */
async function openPortal(page: Page) {
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

  // The job is now recognised as "mine" in the history.
  await page.getByRole("link", { name: "ジョブ" }).click();
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
  await expect(page.getByRole("link", { name: "Jobs" })).toBeVisible();
  await expect(page.getByText("1 copy of each file, 2-sided (long edge), in black & white on A4.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");

  await page.reload();
  await page.evaluate(bookmarkletCode);
  await expect(page.getByRole("link", { name: "Jobs" })).toBeVisible();
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
  await page.getByRole("link", { name: "ジョブ" }).click();
  await expect(page.getByRole("heading", { name: "最近のジョブ" })).toBeVisible();
});
