import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { getPdf } from "../storage";
GlobalWorkerOptions.workerSrc = workerUrl;
export const MAX_PDF_BYTES = 100 * 1024 * 1024;
function open(data: Uint8Array) {
  return getDocument({
    data,
    verbosity: 0,
    useWorkerFetch: false,
    cMapUrl: `${import.meta.env.BASE_URL}pdf/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${import.meta.env.BASE_URL}pdf/standard_fonts/`,
    wasmUrl: `${import.meta.env.BASE_URL}pdf/wasm/`,
  });
}
export async function inspectPdf(file: Blob): Promise<number> {
  if (file.size > MAX_PDF_BYTES)
    throw new Error("PDFは100 MB以下にしてください。");
  const data = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(data.subarray(0, 5)) !== "%PDF-")
    throw new Error("PDF形式のファイルを選んでください。");
  const task = open(data);
  try {
    const doc = await task.promise;
    if (doc.numPages > 1000)
      throw new Error("PDFは1,000ページ以下にしてください。");
    return doc.numPages;
  } catch (e) {
    if (e instanceof Error && e.message.includes("1,000")) throw e;
    // PDF parser errors can contain private document metadata; keep only a safe user-facing category.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(
      e instanceof Error && e.name === "PasswordException"
        ? "パスワード保護されたPDFには対応していません。保護を解除したコピーを選んでください。"
        : "PDFを開けません。破損していないPDFを選んでください。",
    );
  } finally {
    await task.destroy();
  }
}
type Entry = {
  promise: Promise<PDFDocumentProxy>;
  refs: number;
  timer?: ReturnType<typeof setTimeout>;
};
const documents = new Map<string, Entry>();
export function acquirePdf(id: string) {
  let entry = documents.get(id);
  if (!entry) {
    entry = {
      refs: 0,
      promise: getPdf(id).then(async (blob) => {
        if (!blob)
          throw new Error(
            "PDFが見つかりません。バックアップから復元してください。",
          );
        const task = open(new Uint8Array(await blob.arrayBuffer()));
        try {
          return await task.promise;
        } catch {
          await task.destroy();
          throw new Error("PDFを表示できません。");
        }
      }),
    };
    documents.set(id, entry);
  }
  clearTimeout(entry.timer);
  entry.refs++;
  const current = entry;
  return {
    document: entry.promise,
    release() {
      current.refs--;
      if (current.refs === 0)
        current.timer = setTimeout(() => {
          documents.delete(id);
          void current.promise
            .then((doc) => doc.loadingTask.destroy())
            .catch(() => {});
        }, 2000);
    },
  };
}
