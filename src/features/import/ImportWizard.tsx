import { useEffect, useState } from "react";
import { parseScript } from "./parser";
import { inspectPdf } from "../../lib/pdf";
import { saveProject } from "../../lib/storage";
import type { Slide } from "../../domain/types";
export function ImportWizard({
  onComplete,
  onCancel,
}: {
  onComplete: (id: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [pdf, setPdf] = useState<File>();
  const [count, setCount] = useState(0);
  const [text, setText] = useState("");
  const [pages, setPages] =
    useState<{ pageNumber: number; fullScript: string }[]>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (pdf || text || pages || busy) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pdf, text, pages, busy]);
  async function selectPdf(file?: File) {
    setPages(undefined);
    setError("");
    setPdf(undefined);
    setCount(0);
    if (!file) return;
    setBusy(true);
    try {
      const n = await inspectPdf(file);
      setPdf(file);
      setCount(n);
      if (!title) setTitle(file.name.replace(/\.pdf$/i, ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDFを読み込めません。");
    } finally {
      setBusy(false);
    }
  }
  async function selectText(file?: File) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("原稿は2 MB以下にしてください。");
      return;
    }
    try {
      setText(await file.text());
      setPages(undefined);
    } catch {
      setError("原稿ファイルを読み込めません。");
    }
  }
  function preview() {
    setError("");
    try {
      const result = parseScript(text, count || undefined);
      const n = Math.max(count, ...result.pages.map((x) => x.pageNumber), 1);
      if (n > 1000) throw new Error("スライドは1,000枚以下にしてください。");
      setPages(
        Array.from(
          { length: n },
          (_, i) =>
            result.pages.find((x) => x.pageNumber === i + 1) || {
              pageNumber: i + 1,
              fullScript: "",
            },
        ),
      );
      setWarnings(result.warnings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "原稿を確認してください。");
    }
  }
  async function save() {
    if (!pages) return;
    setBusy(true);
    setError("");
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const slides: Slide[] = pages.map((p) => ({
        ...p,
        id: crypto.randomUUID(),
        projectId: id,
        keyPoints: [],
        revision: 1,
      }));
      await saveProject(
        {
          project: {
            id,
            title: title.trim() || "無題の発表",
            pdfAssetId: pdf ? crypto.randomUUID() : undefined,
            pageCount: pages.length,
            createdAt: now,
            updatedAt: now,
            schemaVersion: 1,
          },
          slides,
          sessions: [],
          attempts: [],
        },
        pdf,
      );
      onComplete(id);
    } catch {
      setError(
        "保存できません。空き容量やブラウザの保存設定を確認してください。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel import-panel">
      <p className="eyebrow">NEW PRESENTATION</p>
      <h1>発表を追加</h1>
      <p className="muted">
        PDFと原稿を、このブラウザに読み込みます。どちらか一方だけでも始められます。
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {!pages ? (
        <div className="stack">
          <label>
            発表タイトル
            <input
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <div className="import-grid">
            <label className="file-drop">
              <span className="file-glyph">PDF</span>
              <strong>PDFファイル</strong>
              <span className="muted">100 MB / 1,000ページまで</span>
              <input
                aria-label="PDFファイル"
                type="file"
                accept=".pdf,application/pdf"
                disabled={busy}
                onChange={(e) => void selectPdf(e.target.files?.[0])}
              />
              {pdf && <span>{count}ページを読み込みました</span>}
            </label>
            <label className="file-drop">
              <span className="file-glyph">Aa</span>
              <strong>原稿ファイル</strong>
              <span className="muted">.txt / .md（UTF-8）</span>
              <input
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                onChange={(e) => void selectText(e.target.files?.[0])}
              />
            </label>
          </div>
          <label>
            原稿テキスト
            <textarea
              rows={8}
              value={text}
              maxLength={2000000}
              placeholder={
                "Slide 1:\n最初のスライドで話すこと\n\nSlide 2:\n次のスライドで話すこと"
              }
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="row">
            <button
              className="primary"
              disabled={busy || (!pdf && !text.trim())}
              onClick={preview}
            >
              {busy ? "読み込み中…" : "マッピングを確認"}
            </button>
            <button onClick={onCancel}>キャンセル</button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <h2>ページと原稿の対応</h2>
          <p>
            PDF {count}ページ / 原稿を割り当てるスライド {pages.length}
            枚。空欄や重複はここで編集できます。
          </p>
          {(!pdf || pages.some((p) => !p.fullScript.trim())) && (
            <p className="notice">
              PDFまたは原稿がないスライドがあります。空欄のまま保存し、あとで編集できます。
            </p>
          )}
          {warnings.length > 0 && (
            <ul className="notice">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {pages.map((p, i) => (
            <label key={p.pageNumber}>
              スライド {p.pageNumber}
              {p.pageNumber > count && count > 0 ? "（PDFなし）" : ""}
              <textarea
                aria-label={`スライド ${p.pageNumber} の原稿`}
                rows={3}
                value={p.fullScript}
                onChange={(e) =>
                  setPages(
                    pages.map((s, j) =>
                      j === i ? { ...s, fullScript: e.target.value } : s,
                    ),
                  )
                }
              />
            </label>
          ))}
          <div className="row">
            <button
              className="primary"
              disabled={busy}
              onClick={() => void save()}
            >
              保存して開始
            </button>
            <button disabled={busy} onClick={() => setPages(undefined)}>
              取り込みに戻る
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
