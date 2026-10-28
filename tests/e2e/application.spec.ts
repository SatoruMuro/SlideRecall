import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import type { PracticeAttempt } from "../../src/domain/types";
import {
  answerAndRate,
  assertPdfPage,
  importPresentation,
  observeNetwork,
  readyOffline,
  syntheticTitle,
  syntheticToken,
} from "./helpers";

test("PDFのページ対応、練習履歴、苦手集中、別ブラウザへのZIP復元", async ({
  page,
  browser,
}, testInfo) => {
  await page.goto("./");
  await importPresentation(page);
  await page.screenshot({
    path: testInfo.outputPath("home-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "続きから練習", exact: true }).click();
  await page.getByRole("button", { name: "練習を開始", exact: true }).click();
  await assertPdfPage(page, 1);
  await page.screenshot({
    path: testInfo.outputPath("practice-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await assertPdfPage(page, 1);
  await page.screenshot({
    path: testInfo.outputPath("practice-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByText(syntheticToken, { exact: false })).toHaveCount(0);
  await answerAndRate(page, "◎ スムーズ");
  await page.getByRole("button", { name: "次へ", exact: true }).click();
  await assertPdfPage(page, 2);
  await page.getByRole("button", { name: "ヒントを表示", exact: true }).click();
  await answerAndRate(page, "△ あいまい");
  await page.getByRole("button", { name: "次へ", exact: true }).click();
  await assertPdfPage(page, 3);
  await answerAndRate(page, "◎ スムーズ");
  await page.getByRole("button", { name: "次へ", exact: true }).click();
  await assertPdfPage(page, 2);
  await answerAndRate(page, "△ あいまい");
  await page.getByRole("button", { name: "次へ", exact: true }).click();
  await answerAndRate(page, "△ あいまい");
  await page.getByRole("button", { name: "結果を見る", exact: true }).click();
  await page
    .getByRole("button", { name: "保存した結果を見る", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByText(syntheticTitle, { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "続きから練習", exact: true }).click();
  await page
    .getByRole("combobox", { name: "練習モード", exact: true })
    .selectOption("weak");
  await page.getByRole("button", { name: "練習を開始", exact: true }).click();
  await expect(page.getByTestId("practice-slide-number")).toHaveText(
    "スライド 2",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "保存して終了", exact: true }).click();
  await page
    .getByRole("button", { name: "設定・バックアップ", exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "ZIPを保存", exact: true }).click();
  const download = await downloadPromise;
  const backupPath = testInfo.outputPath("synthetic-backup.zip");
  await download.saveAs(backupPath);
  const zip = await JSZip.loadAsync(await readFile(backupPath));
  const attemptsFile = Object.values(zip.files).find((file) =>
    file.name.endsWith("/attempts.json"),
  )!;
  const attempts = JSON.parse(
    await attemptsFile.async("string"),
  ) as PracticeAttempt[];
  const graded = attempts.filter((attempt) => attempt.rating);
  expect(graded).toHaveLength(5);
  expect(graded.filter((attempt) => attempt.rating === "good")).toHaveLength(2);
  expect(graded.filter((attempt) => attempt.hintsUsed.length > 0)).toHaveLength(
    1,
  );
  expect(
    graded
      .filter((attempt) => attempt.rating === "good")
      .every((attempt) => attempt.hintsUsed.length === 0),
  ).toBe(true);
  const emptyContext = await browser.newContext();
  try {
    const restored = await emptyContext.newPage();
    await restored.goto("http://127.0.0.1:4173/SlideRecall/");
    await restored
      .getByRole("button", { name: "設定・バックアップ", exact: true })
      .click();
    await restored
      .getByLabel("ZIPバックアップを復元", { exact: true })
      .setInputFiles(backupPath);
    await expect(restored.getByRole("status")).toContainText(
      "コピーとして復元しました",
    );
    await restored
      .getByRole("button", { name: "発表一覧", exact: true })
      .click();
    await expect(
      restored.getByText(syntheticTitle, { exact: false }).first(),
    ).toBeVisible();
    await restored
      .getByRole("button", { name: "続きから練習", exact: true })
      .click();
    await restored
      .getByRole("combobox", { name: "練習モード", exact: true })
      .selectOption("weak");
    await restored
      .getByRole("button", { name: "練習を開始", exact: true })
      .click();
    await assertPdfPage(restored, 2);
  } finally {
    await emptyContext.close();
  }
});

test("本番サブパス・ローカル処理の通信検証・オフライン起動と保存", async ({
  page,
  context,
}) => {
  const network = observeNetwork(context);
  const consoleMessages: string[] = [];
  page.on("console", (message) => consoleMessages.push(message.text()));
  page.on("pageerror", (error) => consoleMessages.push(error.message));
  await page.goto("./");
  await importPresentation(page);
  await readyOffline(page);
  await page.getByRole("button", { name: "原稿を編集", exact: true }).click();
  await page
    .getByRole("textbox", { name: "原稿全文", exact: true })
    .fill(`${syntheticToken}\nEdited offline-ready synthetic script.`);
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "編集を終える", exact: true }).click();
  await page.getByRole("button", { name: "続きから練習", exact: true }).click();
  await page.getByRole("button", { name: "練習を開始", exact: true }).click();
  await assertPdfPage(page, 1);
  await answerAndRate(page, "◎ スムーズ");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "保存して終了", exact: true }).click();
  await page
    .getByRole("button", { name: "設定・バックアップ", exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "ZIPを保存", exact: true }).click();
  await downloadPromise;
  const cacheUrls = await page.evaluate(async () => {
    const lists = await Promise.all(
      (await caches.keys()).map(async (name) =>
        (await (await caches.open(name)).keys()).map((request) => request.url),
      ),
    );
    return lists.flat();
  });
  expect(cacheUrls.length).toBeGreaterThan(0);
  expect(
    cacheUrls.every(
      (url) => !url.includes(syntheticToken) && !/\.(pdf|zip)(\?|$)/i.test(url),
    ),
  ).toBe(true);
  const assertOnlyStaticRequests = () => {
    expect(network.failures).toEqual([]);
    for (const request of network.records) {
      const url = new URL(request.url);
      if (url.protocol === "blob:" || url.protocol === "data:") continue;
      expect(url.origin).toBe("http://127.0.0.1:4173");
      expect(url.pathname.startsWith("/SlideRecall/")).toBe(true);
      expect(url.pathname).toMatch(
        /^\/SlideRecall\/(?:$|index\.html$|manifest\.webmanifest$|(?:sw|workbox-[\w-]+)\.js$|icon(?:-\d+)?\.(?:svg|png)$|assets\/[\w.-]+$|pdf\/(?:cmaps|standard_fonts|wasm)\/[\w.-]+$)/,
      );
      expect(request.method).toBe("GET");
      expect(request.body).toBe("");
      expect(JSON.stringify(request)).not.toContain(syntheticToken);
    }
  };
  assertOnlyStaticRequests();
  expect(network.records.some((request) => request.serviceWorker)).toBe(true);
  expect(consoleMessages.join("\n")).not.toContain(syntheticToken);
  expect(page.url()).not.toContain(syntheticToken);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByText(syntheticTitle, { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "原稿を編集", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "原稿全文", exact: true }),
  ).toHaveValue(new RegExp(syntheticToken));
  await assertPdfPage(page, 1);
  await page
    .getByRole("textbox", { name: "原稿全文", exact: true })
    .fill(`${syntheticToken}\nSaved without network.`);
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "原稿を編集", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "原稿全文", exact: true }),
  ).toHaveValue(`${syntheticToken}\nSaved without network.`);
  await page.getByRole("button", { name: "編集を終える", exact: true }).click();
  await page.getByRole("button", { name: "続きから練習", exact: true }).click();
  await page.getByRole("button", { name: "練習を開始", exact: true }).click();
  await assertPdfPage(page, 1);
  await answerAndRate(page, "◎ スムーズ");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "保存して終了", exact: true }).click();
  await page
    .getByRole("button", { name: "設定・バックアップ", exact: true })
    .click();
  const offlineDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "ZIPを保存", exact: true }).click();
  expect((await offlineDownload).suggestedFilename()).toMatch(
    /^SlideRecall-.*\.zip$/,
  );
  assertOnlyStaticRequests();
  expect(consoleMessages.join("\n")).not.toContain(syntheticToken);
});

test("原稿だけの取り込みでも欠番を詰めず、重複と不正PDFを明示する", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: /新しい発表を追加/ }).click();
  await page
    .getByLabel("発表タイトル", { exact: true })
    .fill("番号対応の合成テスト");
  await page
    .getByLabel("PDFファイル", { exact: true })
    .setInputFiles({
      name: "not-a-pdf.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("synthetic invalid file"),
    });
  await expect(page.getByRole("alert")).toContainText("PDF形式");
  await page
    .getByLabel("原稿テキスト", { exact: true })
    .fill(
      "Slide 1:\nFirst line\nSecond line\nSlide 3：\nThird page\nスライド 3:\nDuplicate block",
    );
  await page
    .getByRole("button", { name: "マッピングを確認", exact: true })
    .click();
  await expect(
    page.getByLabel("スライド 1 の原稿", { exact: true }),
  ).toHaveValue("First line\nSecond line");
  await expect(
    page.getByLabel("スライド 2 の原稿", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByLabel("スライド 3 の原稿", { exact: true }),
  ).toHaveValue("Third page\n\nDuplicate block");
  await expect(page.getByText(/重複/).first()).toBeVisible();
  await page.getByRole("button", { name: "保存して開始", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "原稿全文", exact: true }),
  ).toHaveValue("First line\nSecond line");
  await page.getByRole("button", { name: "編集を終える", exact: true }).click();
  await expect(page.getByText("原稿のみ", { exact: true })).toBeVisible();
});
