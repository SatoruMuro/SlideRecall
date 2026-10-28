import { expect, type BrowserContext, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const syntheticToken = "SYNTHETIC_PRIVATE_SCRIPT_7f2bdc0c";
export const syntheticTitle = "合成データの発表";
export const syntheticScript = `Slide 1:\n${syntheticToken}\nFirst synthetic line.\nSecond synthetic line.\nSlide 2：\nA synthetic middle slide.\nスライド 3:\nA synthetic conclusion.`;
export const pageColors = [
  [204, 51, 51],
  [51, 179, 77],
  [51, 77, 204],
];

/** All document bytes are generated here; no real presentation files are used. */
export async function makePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const [index, color] of pageColors.entries()) {
    const page = pdf.addPage([960, 540]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: 960,
      height: 540,
      color: rgb(color[0] / 255, color[1] / 255, color[2] / 255),
    });
    page.drawText(`SYNTHETIC SLIDE ${index + 1}`, {
      x: 48,
      y: 450,
      size: 40,
      color: rgb(1, 1, 1),
      font,
    });
  }
  return Buffer.from(await pdf.save());
}

export async function importPresentation(page: Page, script = syntheticScript) {
  await page.getByRole("button", { name: /新しい発表を追加/ }).click();
  await page.getByLabel("発表タイトル", { exact: true }).fill(syntheticTitle);
  await page
    .getByLabel("PDFファイル", { exact: true })
    .setInputFiles({
      name: "synthetic.pdf",
      mimeType: "application/pdf",
      buffer: await makePdf(),
    });
  await page.getByLabel("原稿テキスト", { exact: true }).fill(script);
  await page
    .getByRole("button", { name: "マッピングを確認", exact: true })
    .click();
  await page.getByRole("button", { name: "保存して開始", exact: true }).click();
  await page.getByRole("button", { name: "編集を終える", exact: true }).click();
}

export async function assertPdfPage(page: Page, number: number) {
  const canvas = page.getByTestId("pdf-canvas").first();
  await expect(canvas).toHaveAttribute("data-page-number", String(number));
  await expect
    .poll(async () =>
      canvas.evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        if (!canvas.width || !canvas.height) return [];
        return Array.from(
          canvas
            .getContext("2d")!
            .getImageData(
              Math.floor(canvas.width / 2),
              Math.floor(canvas.height / 2),
              1,
              1,
            ).data,
        ).slice(0, 3);
      }),
    )
    .toEqual(pageColors[number - 1]);
}

export async function answerAndRate(
  page: Page,
  rating: "◎ スムーズ" | "△ あいまい" | "× 再現困難",
) {
  await page
    .getByRole("button", { name: "発話を終えて答え合わせ", exact: true })
    .click();
  await page.getByRole("button", { name: "自己評価へ", exact: true }).click();
  await page.getByRole("button", { name: rating, exact: true }).click();
}

export async function readyOffline(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // A newly installed prompt-mode worker controls the next navigation.
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller)))
    await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
}

export function observeNetwork(context: BrowserContext) {
  const records: {
    url: string;
    method: string;
    body: string;
    headers: string;
    serviceWorker: boolean;
  }[] = [];
  const failures: string[] = [];
  context.on("request", (request) =>
    records.push({
      url: request.url(),
      method: request.method(),
      body: request.postData() ?? "",
      headers: JSON.stringify(request.headers()),
      serviceWorker: !!request.serviceWorker(),
    }),
  );
  context.on("response", (response) => {
    if (response.status() >= 400)
      failures.push(`${response.status()} ${response.url()}`);
  });
  return { records, failures };
}
