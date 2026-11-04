import { test, expect, type Locator, type Page } from "@playwright/test";
import { assertPdfPage, importPresentation } from "./helpers";
import { PDFDocument, rgb } from "pdf-lib";

const longScript = Array.from({ length: 60 }, (_, index) =>
  `説明${index + 1}。これは画面の配置を確認するための架空の原稿です。` +
  "PDFを見ながら長い原稿をスクロールしても、練習の操作を続けられます。" +
  (index === 20 ? ` ${"SyntheticUnbrokenText".repeat(18)}` : ""),
).join("\n\n");
const importScript = [1, 2, 3]
  .map((number) => `Slide ${number}:\n${longScript}`)
  .join("\n");
const targets = [
  { width: 1440, height: 900, dark: false },
  { width: 1366, height: 768, dark: true },
  { width: 768, height: 1024, dark: false },
  { width: 390, height: 844, dark: false },
  { width: 375, height: 667, dark: true },
];
type Mode = "sequential" | "weak" | "random" | "rehearsal";

async function box(locator: Locator) {
  const result = await locator.boundingBox();
  expect(result, "visible element has a layout box").not.toBeNull();
  return result!;
}

async function expectInsideViewport(page: Page, locator: Locator) {
  const bounds = await box(locator);
  const viewport = await page.evaluate(() => ({ width:innerWidth, height:innerHeight }));
  expect(bounds.x).toBeGreaterThanOrEqual(-2);
  expect(bounds.y).toBeGreaterThanOrEqual(-2);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 2);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 2);
}

async function expectNoHorizontalOverflow(page: Page) {
  const size = await page.evaluate(() => ({
    width: innerWidth,
    content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
  }));
  expect(size.content).toBeLessThanOrEqual(size.width + 2);
}

async function startMode(page: Page, mode: Mode = "sequential") {
  await page.getByRole("button", { name: "続きから練習", exact: true }).click();
  await page.getByRole("combobox", { name: "練習モード", exact: true }).selectOption(mode);
  await page.getByRole("button", { name: "練習を開始", exact: true }).click();
  const marker = page.getByTestId("practice-slide-number");
  await expect(marker).toBeVisible();
  const number = Number((await marker.innerText()).match(/\d+/)![0]);
  await assertPdfPage(page, number);
}

async function exitToHome(page: Page) {
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "保存して終了", exact: true }).click();
  await page.getByRole("button", { name: "発表一覧", exact: true }).click();
}

async function assertWorkspace(page: Page) {
  const viewport = await page.evaluate(() => ({ width:innerWidth, height:innerHeight }));
  const slide = page.locator(".practice-slide");
  const panel = page.locator(".practice-side-panel");
  const content = page.getByRole("region", { name: "ヒントと原稿", exact: true });
  await expect(content).toBeVisible();
  const canvas = page.getByTestId("pdf-canvas");
  const [slideBox, panelBox, canvasBox, contentBox, controlsBox] = await Promise.all([
    box(slide), box(panel), box(canvas), box(content), box(page.locator(".practice-controls")),
  ]);
  await expectNoHorizontalOverflow(page);
  await expectInsideViewport(page, canvas);
  await expectInsideViewport(page, page.locator(".practice-controls"));
  expect(canvasBox.width / canvasBox.height).toBeCloseTo(16 / 9, 1);
  expect(canvasBox.width).toBeGreaterThan(100);
  expect(canvasBox.height).toBeGreaterThan(50);
  expect(canvasBox.x).toBeGreaterThanOrEqual(slideBox.x - 2);
  expect(canvasBox.y).toBeGreaterThanOrEqual(slideBox.y - 2);
  expect(canvasBox.x + canvasBox.width).toBeLessThanOrEqual(slideBox.x + slideBox.width + 2);
  expect(canvasBox.y + canvasBox.height).toBeLessThanOrEqual(slideBox.y + slideBox.height + 2);
  expect(contentBox.y + contentBox.height).toBeLessThanOrEqual(controlsBox.y + 2);
  if (viewport.width >= 900) {
    expect(slideBox.x + slideBox.width).toBeLessThanOrEqual(panelBox.x + 2);
    expect(Math.abs(slideBox.y - panelBox.y)).toBeLessThanOrEqual(3);
    const fraction = slideBox.width / (slideBox.width + panelBox.width);
    expect(fraction).toBeGreaterThan(0.56);
    expect(fraction).toBeLessThan(0.64);
  } else {
    expect(slideBox.y + slideBox.height).toBeLessThanOrEqual(panelBox.y + 2);
    const heightFraction = slideBox.height / viewport.height;
    expect(heightFraction).toBeGreaterThanOrEqual(0.29);
    expect(heightFraction).toBeLessThanOrEqual(0.41);
  }
  const buttons = page.locator(".practice-controls button");
  for (const button of await buttons.all()) {
    if (!await button.isVisible()) continue;
    await expectInsideViewport(page, button);
    // A bounding box can look correct while a fixed/overflow layer covers the button.
    const unobstructed = await button.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return !!hit && (hit === element || element.contains(hit));
    });
    expect(unobstructed, "practice controls are not obscured by script content").toBe(true);
  }
}

async function expectFirstScriptLineVisible(page: Page, level: number) {
  const text = page.locator(level < 3 ? ".sentence-cue-list li" : ".script-text").first();
  const line = await text.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.textContent?.trim()) node = walker.nextNode();
    if (!node) return null;
    const start = node.textContent!.search(/\S/);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, Math.min(start + 4, node.textContent!.length));
    const rect = range.getClientRects()[0];
    return rect ? { top:rect.top, bottom:rect.bottom } : null;
  });
  expect(line, "hint or script has a rendered first text line").not.toBeNull();
  const content = await box(page.locator(".practice-content"));
  const controls = await box(page.locator(".practice-controls"));
  expect(line!.top).toBeGreaterThanOrEqual(content.y - 1);
  expect(line!.bottom, "first text line is visible below the hint headings without scrolling").toBeLessThanOrEqual(content.y + content.height + 1);
  expect(line!.bottom).toBeLessThanOrEqual(controls.y + 1);
}

async function revealAllHints(page: Page) {
  for (let level = 1; level <= 3; level++) {
    await page.getByRole("button", { name: "ヒントを表示", exact: true }).click();
    await expect(page.getByRole("heading", { name: `ヒント ${level}/3`, exact: true })).toBeVisible();
    await assertWorkspace(page);
    await expectFirstScriptLineVisible(page, level);
  }
  await expect(page.locator(".script-text")).toContainText("説明60。");
}

async function assertIndependentScroll(page: Page, input: "wheel" | "keyboard" = "wheel") {
  const content = page.locator(".practice-content");
  const before = await box(page.getByTestId("pdf-canvas"));
  const controlBefore = await box(page.locator(".practice-controls"));
  const windowBefore = await page.evaluate(() => scrollY);
  const scrollSize = await content.evaluate((element) => ({ height: element.clientHeight, total: element.scrollHeight }));
  expect(scrollSize.total).toBeGreaterThan(scrollSize.height + 100);
  if (input === "keyboard") {
    await content.focus();
    await page.keyboard.press("PageDown");
  } else {
    await content.hover();
    await page.mouse.wheel(0, 500);
  }
  await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const after = await box(page.getByTestId("pdf-canvas"));
  const controlAfter = await box(page.locator(".practice-controls"));
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(controlAfter.y - controlBefore.y)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => scrollY)).toBe(windowBefore);
  await assertWorkspace(page);
  await content.evaluate((element) => { element.scrollTop = 0; });
}

for (const viewport of targets) {
  test(`長い原稿でもPDFと操作を同時に表示 ${viewport.width}x${viewport.height} ${viewport.dark ? "dark" : "light"}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("./");
    await importPresentation(page, importScript);
    if (viewport.dark) await page.getByRole("button", { name: "ダークテーマに切替", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", viewport.dark ? "dark" : "light");
    await startMode(page);
    await assertWorkspace(page);
    const canvas = await page.getByTestId("pdf-canvas").elementHandle();
    const initial = await box(page.getByTestId("pdf-canvas"));
    let extraPdfWorkers = 0;
    page.on("worker", worker => { if (worker.url().includes("pdf.worker")) extraPdfWorkers++; });
    await expect(page.locator(".script-text")).toHaveCount(0);
    await revealAllHints(page);
    await assertIndependentScroll(page);
    await expect.poll(() => canvas!.evaluate(element => element.isConnected && element === document.querySelector('[data-testid="pdf-canvas"]'))).toBe(true);
    const revealed = await box(page.getByTestId("pdf-canvas"));
    for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(revealed[key] - initial[key])).toBeLessThanOrEqual(2);
    expect(extraPdfWorkers).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`layout-${viewport.width}x${viewport.height}.png`) });
    await page.getByRole("button", { name: "発話を終えて答え合わせ", exact: true }).click();
    await assertWorkspace(page);
    await page.getByRole("button", { name: "自己評価へ", exact: true }).click();
    await assertWorkspace(page);
    await expectInsideViewport(page, page.getByRole("button", { name: "△ あいまい", exact: true }));
    await page.getByRole("button", { name: "△ あいまい", exact: true }).click();
    await assertWorkspace(page);
    await page.getByRole("button", { name: "次へ", exact: true }).click();
    await assertPdfPage(page, 2);
    await expect(page.locator(".script-text")).toHaveCount(0);
    await assertWorkspace(page);
    await exitToHome(page);
  });
}

for (const viewport of [{ width:1440, height:900 }, { width:390, height:844 }]) {
  test(`苦手・ランダム・本番リハーサルでも配置を維持 ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("./");
    await importPresentation(page, importScript);
    await startMode(page);
    await page.getByRole("button", { name: "発話を終えて答え合わせ", exact:true }).click();
    await page.getByRole("button", { name: "自己評価へ", exact:true }).click();
    await page.getByRole("button", { name: "△ あいまい", exact:true }).click();
    await exitToHome(page);
    for (const mode of ["weak", "random", "rehearsal"] as const) {
      await startMode(page, mode);
      if (mode === "rehearsal") {
        await expect(page.getByRole("button", { name:"ヒントを表示", exact:true })).toHaveCount(0);
        await page.getByRole("button", { name:"ヒント操作を有効にする", exact:true }).click();
      }
      await revealAllHints(page);
      await assertIndependentScroll(page);
      if (mode === "rehearsal") {
        await expectInsideViewport(page, page.getByRole("button", { name:"次のスライドへ", exact:true }));
        await page.getByRole("button", { name:"次のスライドへ", exact:true }).click();
        await assertPdfPage(page, 2);
        await assertWorkspace(page);
      } else {
        await page.getByRole("button", { name:"発話を終えて答え合わせ", exact:true }).click();
        await page.getByRole("button", { name:"自己評価へ", exact:true }).click();
        await assertWorkspace(page);
      }
      await exitToHome(page);
    }
  });
}

test("全画面APIとCSSフォールバックの両方でPDF・原稿・操作を維持", async ({ page }) => {
  await page.setViewportSize({ width:1440, height:900 });
  await page.goto("./");
  await importPresentation(page, importScript);
  await startMode(page);
  await revealAllHints(page);
  await page.getByRole("button", { name:"全画面", exact:true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await assertWorkspace(page);
  await assertIndependentScroll(page, "keyboard");
  await page.getByRole("button", { name:"全画面を終了", exact:true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await assertWorkspace(page);
  await page.setViewportSize({ width:390, height:844 });
  await page.evaluate(() => {
    Element.prototype.requestFullscreen = () => Promise.reject(new DOMException("Synthetic fullscreen denial", "NotAllowedError"));
  });
  await page.getByRole("button", { name:"全画面", exact:true }).click();
  await expect(page.locator(".practice-stage")).toHaveClass(/practice-fullscreen/);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await assertWorkspace(page);
  await assertIndependentScroll(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(".practice-stage")).not.toHaveClass(/practice-fullscreen/);
  await assertWorkspace(page);
});

test("原稿領域にフォーカスしたまま既存の練習ショートカットを使える", async ({ page }) => {
  await page.setViewportSize({ width:1366, height:768 });
  await page.goto("./");
  await importPresentation(page, importScript);
  await startMode(page);
  const content = page.getByRole("region", { name:"ヒントと原稿", exact:true });
  await content.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name:"タイマーを再開", exact:true })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name:"一時停止", exact:true })).toBeVisible();
  await page.keyboard.press("h");
  await expect(page.getByRole("heading", { name:"ヒント 1/3", exact:true })).toBeVisible();
  await page.getByRole("button", { name:"発話を終えて答え合わせ", exact:true }).click();
  await content.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name:"△ あいまい", exact:true })).toBeVisible();
  await page.keyboard.press("2");
  await expect(page.getByRole("button", { name:"次へ", exact:true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await assertPdfPage(page, 2);
  page.once("dialog", dialog => dialog.accept());
  await page.keyboard.press("ArrowLeft");
  await assertPdfPage(page, 1);
  await assertWorkspace(page);
});

test("高さの低い画面でも原稿と操作へ到達できる", async ({ page }) => {
  await page.setViewportSize({ width:1440, height:600 });
  await page.goto("./");
  await importPresentation(page, importScript);
  await startMode(page);
  await revealAllHints(page);
  await assertIndependentScroll(page);
  await page.setViewportSize({ width:667, height:320 });
  await expectNoHorizontalOverflow(page);
  const content = page.locator(".practice-content");
  await content.scrollIntoViewIfNeeded();
  await expect(content).toBeVisible();
  await content.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const finish = page.getByRole("button", { name:"発話を終えて答え合わせ", exact:true });
  await finish.scrollIntoViewIfNeeded();
  await expect(finish).toBeInViewport();
  await finish.click();
  const rate = page.getByRole("button", { name:"自己評価へ", exact:true });
  await rate.scrollIntoViewIfNeeded();
  await rate.click();
  const good = page.getByRole("button", { name:"◎ スムーズ", exact:true });
  await good.scrollIntoViewIfNeeded();
  await expect(good).toBeInViewport();
  await good.click();
  await expectNoHorizontalOverflow(page);
});

test("更新通知が表示されてもスマートフォンの練習操作へ到達できる", async ({ page }) => {
  await page.setViewportSize({ width:390, height:667 });
  await page.goto("./");
  await importPresentation(page, importScript);
  await startMode(page);
  // The real SW update notice is outside the practice stage and consumes shell height.
  // Insert its presentation here to exercise the layout without publishing a second SW.
  await page.evaluate(() => {
    const main = document.querySelector(".practice-main")!;
    const notice = document.createElement("div");
    notice.className = "notice row";
    notice.setAttribute("role", "status");
    const message = document.createElement("span");
    message.textContent = "新しいバージョンがあります。作業を終えてから更新できます。";
    const button = document.createElement("button");
    button.textContent = "更新して再読み込み";
    button.disabled = true;
    notice.append(message, button);
    main.insertBefore(notice, main.firstChild);
  });
  const panel = await box(page.locator(".practice-side-panel"));
  const controls = await box(page.locator(".practice-controls"));
  expect(controls.y + controls.height).toBeLessThanOrEqual(panel.y + panel.height + 2);
  const contentHeight = await page.locator(".practice-content").evaluate(element => element.clientHeight);
  expect(contentHeight).toBeGreaterThanOrEqual(70);
  const workspace = page.locator(".practice-workspace");
  await expect.poll(() => workspace.evaluate(element => getComputedStyle(element).overflowY)).toMatch(/auto|scroll/);
  const workspaceBox = await box(workspace);
  const slide = await box(page.locator(".practice-slide"));
  // Wheel in the gap between PDF and panel, so the outer workspace receives it.
  await page.mouse.move(workspaceBox.x + workspaceBox.width / 2, slide.y + slide.height + 2);
  await page.mouse.wheel(0, 500);
  await expect.poll(() => workspace.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expectNoHorizontalOverflow(page);
  const hint = page.getByRole("button", { name:"ヒントを表示", exact:true });
  for (let level = 1; level <= 3; level++) {
    await expectInsideViewport(page, hint);
    await hint.click();
    await expect(page.getByRole("heading", { name:`ヒント ${level}/3`, exact:true })).toBeVisible();
    const after = await box(page.locator(".practice-side-panel"));
    expect(Math.abs(after.height - panel.height)).toBeLessThanOrEqual(2);
    const footer = await box(page.locator(".practice-controls"));
    expect(footer.y + footer.height).toBeLessThanOrEqual(after.y + after.height + 2);
  }
  const content = page.locator(".practice-content");
  const sizes = await content.evaluate(element => ({ visible:element.clientHeight, total:element.scrollHeight }));
  expect(sizes.visible).toBeGreaterThanOrEqual(70);
  expect(sizes.total).toBeGreaterThan(sizes.visible + 100);
  const workspaceScroll = await workspace.evaluate(element => element.scrollTop);
  await content.focus();
  await page.keyboard.press("PageDown");
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await workspace.evaluate(element => element.scrollTop)).toBe(workspaceScroll);
  const finish = page.getByRole("button", { name:"発話を終えて答え合わせ", exact:true });
  await finish.scrollIntoViewIfNeeded();
  await expect(finish).toBeInViewport();
  await finish.click();
  const rate = page.getByRole("button", { name:"自己評価へ", exact:true });
  await rate.scrollIntoViewIfNeeded();
  await rate.click();
  const good = page.getByRole("button", { name:"◎ スムーズ", exact:true });
  await good.scrollIntoViewIfNeeded();
  await expect(good).toBeInViewport();
  await good.click();
  await expectNoHorizontalOverflow(page);
});

test("縦長PDFは画面の幅と高さに合わせて縮小され、リサイズ後も比率を保つ", async ({ page }) => {
  const pdf = await PDFDocument.create();
  const portrait = pdf.addPage([720, 960]);
  portrait.drawRectangle({ x:0, y:0, width:720, height:960, color:rgb(0.8, 0.2, 0.2) });
  await page.setViewportSize({ width:1440, height:900 });
  await page.goto("./");
  await page.getByRole("button", { name:/新しい発表を追加/ }).click();
  await page.getByLabel("発表タイトル", { exact:true }).fill("縦長PDFの合成テスト");
  await page.getByLabel("PDFファイル", { exact:true }).setInputFiles({ name:"synthetic-portrait.pdf", mimeType:"application/pdf", buffer:Buffer.from(await pdf.save()) });
  await page.getByLabel("原稿テキスト", { exact:true }).fill(`Slide 1:\n${longScript}`);
  await page.getByRole("button", { name:"マッピングを確認", exact:true }).click();
  await page.getByRole("button", { name:"保存して開始", exact:true }).click();
  await page.getByRole("button", { name:"練習を開始", exact:true }).click();
  const canvas = page.getByTestId("pdf-canvas");
  await expect(canvas).toHaveAttribute("data-page-number", "1");
  let initialHeight = 0;
  for (const viewport of [
    { width:1440, height:900 },
    { width:1440, height:600 },
    { width:390, height:844 },
    { width:1440, height:900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => {
      const bounds = await canvas.boundingBox();
      const slide = await page.locator(".practice-slide").boundingBox();
      return !!bounds && !!slide && bounds.width > 50 && bounds.height > 50 &&
        Math.abs(bounds.width / bounds.height - 0.75) < 0.02 &&
        bounds.x >= slide.x - 2 && bounds.y >= slide.y - 2 &&
        bounds.x + bounds.width <= slide.x + slide.width + 2 &&
        bounds.y + bounds.height <= slide.y + slide.height + 2 &&
        bounds.y + bounds.height <= viewport.height + 2;
    }).toBe(true);
    await expect.poll(() => canvas.evaluate((element) => {
      const target = element as HTMLCanvasElement;
      return Array.from(target.getContext("2d")!.getImageData(Math.floor(target.width / 2), Math.floor(target.height / 2), 1, 1).data).slice(0,3);
    })).toEqual([204,51,51]);
    await expectInsideViewport(page, canvas);
    await expectInsideViewport(page, page.locator(".practice-controls"));
    await expectNoHorizontalOverflow(page);
    const bounds = await box(canvas);
    if (!initialHeight) initialHeight = bounds.height;
    if (viewport.height === 600) expect(bounds.height).toBeLessThan(initialHeight - 100);
  }
});
