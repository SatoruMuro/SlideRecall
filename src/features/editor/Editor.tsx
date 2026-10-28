import { useEffect, useRef, useState } from "react";
import type { ProjectData, Slide } from "../../domain/types";
import { saveSlide } from "../../lib/storage";
import { PdfSlide } from "../../components/PdfSlide";
export function Editor({
  data,
  onExit,
}: {
  data: ProjectData;
  onExit: () => void;
}) {
  const [slides, setSlides] = useState(data.slides);
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState("保存済み");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const latest = useRef(slides);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const slide = slides[selected];
  const dirty = useRef(new Map<string, Slide>());
  const queue = useRef(new Map<string, Slide>());
  const failures = useRef(new Set<string>());
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current.size || saving.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      mounted.current = false;
      window.removeEventListener("beforeunload", warn);
    };
  }, []);
  function reflectSaveState() {
    if (!mounted.current) return;
    setPending(saving.current || queue.current.size > 0);
    setUnsaved(dirty.current.size > 0);
    setFailed(failures.current.size > 0);
    const pages = latest.current
      .filter((s) => failures.current.has(s.id))
      .map((s) => s.pageNumber)
      .join("、");
    setStatus(
      pages
        ? `スライド ${pages} を保存できません。空き容量を確認し、再保存してください。`
        : saving.current
          ? "保存中…"
          : "保存済み",
    );
  }
  async function drainQueue() {
    if (saving.current) return;
    saving.current = true;
    reflectSaveState();
    while (queue.current.size) {
      const [id, next] = queue.current.entries().next().value!;
      queue.current.delete(id);
      try {
        await saveSlide(next);
        if (dirty.current.get(id)?.revision === next.revision) {
          dirty.current.delete(id);
          failures.current.delete(id);
        }
      } catch {
        failures.current.add(id);
      }
      reflectSaveState();
    }
    saving.current = false;
    reflectSaveState();
  }
  // Coalesce pending edits; active transactions finish before newer revisions.
  function persist(next: Slide) {
    dirty.current.set(next.id, next);
    queue.current.set(next.id, next);
    reflectSaveState();
    void drainQueue();
  }
  function update(change: Partial<Slide>) {
    const old = latest.current[selected];
    if (
      Object.entries(change).every(([key, value]) =>
        Object.is(old[key as keyof Slide], value),
      )
    )
      return;
    const next = { ...old, ...change, revision: old.revision + 1 };
    const all = latest.current.map((s, i) => (i === selected ? next : s));
    latest.current = all;
    setSlides(all);
    persist(next);
  }
  function exit() {
    if (!dirty.current.size && !saving.current && !queue.current.size) onExit();
  }
  function move(index: number, offset: number) {
    const points = [...slide.keyPoints];
    [points[index], points[index + offset]] = [
      points[index + offset],
      points[index],
    ];
    update({ keyPoints: points });
  }
  if (!slide) return <p>スライドがありません。</p>;
  return (
    <section>
      <div className="section-heading">
        <div>
          <p className="eyebrow">SCRIPT WORKSPACE</p>
          <h1>{data.project.title}</h1>
        </div>
        <div className="row">
          <span role="status" className={failed ? "error" : "muted"}>
            {status}
          </span>
          {failed && (
            <button
              disabled={pending}
              onClick={() => [...dirty.current.values()].forEach(persist)}
            >
              再保存
            </button>
          )}
          <button disabled={pending || unsaved} onClick={exit}>
            編集を終える
          </button>
        </div>
      </div>
      <div className="editor-layout">
        <nav className="slide-list" aria-label="スライド一覧">
          {slides.map((s, i) => (
            <button
              key={s.id}
              aria-current={i === selected ? "page" : undefined}
              onClick={() => setSelected(i)}
            >
              <span>{String(s.pageNumber).padStart(2, "0")}</span>
              <span>{s.fullScript.slice(0, 24) || "原稿未設定"}</span>
            </button>
          ))}
        </nav>
        <div className="editor-main">
          <PdfSlide
            assetId={data.project.pdfAssetId}
            pageNumber={slide.pageNumber}
          />
          <div className="panel stack">
            <div className="section-heading">
              <h2>スライド {slide.pageNumber}</h2>
              <span className="badge">原稿 v{slide.revision}</span>
            </div>
            <label>
              原稿全文
              <textarea
                ref={textRef}
                rows={8}
                maxLength={2000000}
                value={slide.fullScript}
                onChange={(e) => update({ fullScript: e.target.value })}
              />
            </label>
            <div className="row">
              <button
                onClick={() => {
                  const text = textRef.current;
                  const chosen = text
                    ? slide.fullScript.slice(
                        text.selectionStart,
                        text.selectionEnd,
                      )
                    : "";
                  update({
                    openingExact:
                      chosen ||
                      slide.fullScript.split(/(?<=[。.!?！？])\s*|\n/)[0] ||
                      "",
                  });
                }}
              >
                選択範囲・最初の文を冒頭へ
              </button>
              <span className="muted">
                候補を確認し、自分で調整してください。
              </span>
            </div>
            <label>
              冒頭アンカーフレーズ
              <input
                maxLength={2000000}
                value={slide.openingExact || ""}
                onChange={(e) => update({ openingExact: e.target.value })}
              />
            </label>
            <fieldset>
              <legend>重要説明ポイント</legend>
              <p className="muted">
                順番と意味を思い出すための短いキーワード。最大200件。
              </p>
              {slide.keyPoints.map((point, i) => (
                <div className="point-row" key={point.id}>
                  <input
                    aria-label={`ポイント ${i + 1}`}
                    maxLength={2000000}
                    value={point.text}
                    onChange={(e) =>
                      update({
                        keyPoints: slide.keyPoints.map((p, j) =>
                          i === j ? { ...p, text: e.target.value } : p,
                        ),
                      })
                    }
                  />
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={point.required}
                      onChange={(e) =>
                        update({
                          keyPoints: slide.keyPoints.map((p, j) =>
                            i === j ? { ...p, required: e.target.checked } : p,
                          ),
                        })
                      }
                    />
                    必須
                  </label>
                  <button
                    aria-label={`ポイント ${i + 1} を上へ`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`ポイント ${i + 1} を下へ`}
                    disabled={i === slide.keyPoints.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    aria-label={`ポイント ${i + 1} を削除`}
                    onClick={() =>
                      update({
                        keyPoints: slide.keyPoints.filter((_, j) => j !== i),
                      })
                    }
                  >
                    削除
                  </button>
                </div>
              ))}
              <button
                disabled={slide.keyPoints.length >= 200}
                onClick={() =>
                  update({
                    keyPoints: [
                      ...slide.keyPoints,
                      { id: crypto.randomUUID(), text: "", required: true },
                    ],
                  })
                }
              >
                ポイントを追加
              </button>
            </fieldset>
            <label>
              締めアンカーフレーズ
              <input
                maxLength={2000000}
                value={slide.closingExact || ""}
                onChange={(e) => update({ closingExact: e.target.value })}
              />
            </label>
            <label>
              次スライドへの接続フレーズ
              <input
                maxLength={2000000}
                value={slide.transitionToNext || ""}
                onChange={(e) => update({ transitionToNext: e.target.value })}
              />
            </label>
            <label>
              目標時間（秒・任意）
              <input
                type="number"
                min="1"
                max="86400"
                value={slide.targetSeconds || ""}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  update({
                    targetSeconds: n > 0 ? Math.min(86400, n) : undefined,
                  });
                }}
              />
            </label>
            <p className="muted">
              アンカーが空欄でも練習できます。編集すると原稿の版が変わり、以前の評価と区別されます。
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
