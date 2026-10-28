import { useEffect, useRef, useState } from "react";
import { acquirePdf } from "../lib/pdf";
import type { RenderTask } from "pdfjs-dist";
export function PdfSlide({
  assetId,
  pageNumber,
}: {
  assetId?: string;
  pageNumber: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setError("");
    setReady(false);
    if (!assetId) return;
    const handle = acquirePdf(assetId);
    let disposed = false;
    let render: RenderTask | undefined;
    let sequence = Promise.resolve();
    let version = 0;
    const paint = () => {
      const requested = ++version;
      render?.cancel();
      sequence = sequence
        .catch(() => {})
        .then(async () => {
          if (disposed || requested !== version) return;
          const doc = await handle.document;
          if (disposed) return;
          if (pageNumber > doc.numPages) {
            setError("この番号に対応するPDFページはありません。");
            return;
          }
          const page = await doc.getPage(pageNumber);
          if (
            disposed ||
            requested !== version ||
            !canvas.current ||
            !container.current
          )
            return;
          const bounds = container.current.getBoundingClientRect();
          const original = page.getViewport({ scale: 1 });
          if (bounds.width <= 24 || bounds.height <= 24) return;
          const scale = Math.min(
            (bounds.width - 24) / original.width,
            (bounds.height - 24) / original.height,
          );
          const ratio = Math.min(window.devicePixelRatio || 1, 2);
          const viewport = page.getViewport({ scale: scale * ratio });
          canvas.current.width = viewport.width;
          canvas.current.height = viewport.height;
          canvas.current.style.width = `${viewport.width / ratio}px`;
          canvas.current.style.height = `${viewport.height / ratio}px`;
          render = page.render({ canvas: canvas.current, viewport });
          try {
            await render.promise;
            if (!disposed && requested === version) setReady(true);
          } catch (e) {
            if (
              !(e instanceof Error) ||
              e.name !== "RenderingCancelledException"
            )
              throw e;
          }
        })
        .catch(() => {
          if (!disposed)
            setError(
              "PDFを表示できません。ページを選び直すか、バックアップから復元してください。",
            );
        });
    };
    const observer = new ResizeObserver(paint);
    if (container.current) observer.observe(container.current);
    paint();
    return () => {
      disposed = true;
      observer.disconnect();
      render?.cancel();
      void sequence.finally(handle.release);
    };
  }, [assetId, pageNumber]);
  return (
    <div
      className="pdf-stage"
      ref={container}
      aria-busy={!!assetId && !ready && !error}
    >
      {!assetId ? (
        <div className="pdf-empty">
          <span className="slide-number">
            {String(pageNumber).padStart(2, "0")}
          </span>
          <p>原稿のみのスライド</p>
        </div>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : (
        <>
          <canvas
            ref={canvas}
            data-testid="pdf-canvas"
            data-page-number={ready ? pageNumber : undefined}
            aria-label={`PDF スライド ${pageNumber}`}
            role="img"
          />
          {!ready && <span className="loading">PDFを表示中…</span>}
        </>
      )}
    </div>
  );
}
