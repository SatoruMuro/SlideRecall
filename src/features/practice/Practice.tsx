import { useEffect, useRef, useState } from "react";
import type {
  PracticeAttempt,
  PracticeMode,
  PracticeSession,
  ProjectData,
  Rating,
} from "../../domain/types";
import { modeLabels, ratingLabels } from "../../domain/types";
import { PdfSlide } from "../../components/PdfSlide";
import { saveSession } from "../../lib/storage";
import {
  buildQueue,
  elapsedSeconds,
  finishAttempt,
  formatDuration,
  MAX_ATTEMPTS_PER_SLIDE,
  pauseClock,
  resumeClock,
  revealHint,
  scheduleRetry,
  type ClockState,
} from "./engine";
import "./practice.css";

type Phase = "recall" | "answer" | "rating" | "next" | "summary";
type Run = {
  session: PracticeSession;
  queue: string[];
  index: number;
  attempts: PracticeAttempt[];
  draft: PracticeAttempt;
  clock: ClockState;
  phase: Phase;
};
type Props = {
  data: ProjectData;
  onExit: () => void;
  initialMode?: PracticeMode;
};
function replaceAttempt(
  attempts: PracticeAttempt[],
  attempt: PracticeAttempt,
): PracticeAttempt[] {
  return [...attempts.filter((a) => a.id !== attempt.id), attempt];
}

export function Practice({ data, onExit, initialMode = "sequential" }: Props) {
  const [mode, setMode] = useState<PracticeMode>(initialMode);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(
    Math.max(...data.slides.map((s) => s.pageNumber), 1),
  );
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [rehearsalHints, setRehearsalHints] = useState(false);
  const [, tick] = useState(0);
  const stage = useRef<HTMLElement>(null);
  const runRef = useRef(run);
  const operation = useRef(false);
  const pending = useRef(Promise.resolve());
  const update = (next: Run | null) => {
    runRef.current = next;
    setRun(next);
  };
  const current = run && data.slides.find((s) => s.id === run.queue[run.index]);
  const resumable = [...data.sessions]
    .filter((s) => !s.endedAt)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const now = () => performance.now();
  const newDraft = (sessionId: string, slideId: string): PracticeAttempt => ({
    id: crypto.randomUUID(),
    sessionId,
    slideId,
    slideRevision: data.slides.find((s) => s.id === slideId)!.revision,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationSeconds: 0,
    hintsUsed: [],
  });

  const persist = (next: Run) => {
    const attempts =
      next.phase === "recall"
        ? replaceAttempt(
            next.attempts,
            finishAttempt(
              next.draft,
              elapsedSeconds(next.clock, now()),
              new Date().toISOString(),
            ),
          )
        : next.attempts;
    const progress =
      next.phase === "summary"
        ? undefined
        : { index: next.index, phase: next.phase, attemptId: next.draft.id };
    const task = pending.current
      .catch(() => undefined)
      .then(() =>
        saveSession(
          { ...next.session, slideIds: next.queue, progress },
          attempts,
        ),
      );
    pending.current = task;
    return task;
  };
  async function commit(next: Run) {
    if (operation.current) return false;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      await persist(next);
      update(next);
      return true;
    } catch {
      setError(
        "練習記録を保存できませんでした。空き容量やブラウザの保存設定を確認し、もう一度操作してください。",
      );
      return false;
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 200);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (runRef.current && runRef.current.phase !== "summary") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const visibility = () => {
      const active = runRef.current;
      if (
        document.visibilityState === "hidden" &&
        active &&
        active.phase === "recall"
      ) {
        const paused = {
          ...active,
          clock: pauseClock(active.clock, performance.now()),
        };
        update(paused);
        void persist(paused).catch(() =>
          setError(
            "途中の記録を保存できませんでした。画面を閉じる前に保存して終了してください。",
          ),
        );
      }
    };
    const fullscreen = () => {
      if (!document.fullscreenElement) setFullScreen(false);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("fullscreenchange", fullscreen);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("fullscreenchange", fullscreen);
    };
    // Event handlers read the latest run through the ref; data is fixed for this mounted practice screen.
  }, []);

  async function start(resume = false) {
    let queue = buildQueue(data.slides, data.attempts, mode, from, to);
    let session: PracticeSession = {
      id: crypto.randomUUID(),
      projectId: data.project.id,
      mode,
      startedAt: new Date().toISOString(),
      slideIds: queue,
    };
    let attempts: PracticeAttempt[] = [];
    let index = 0;
    let phase: Phase = "recall";
    let draft: PracticeAttempt | undefined;
    if (resume && resumable) {
      session = resumable;
      queue = resumable.slideIds.filter((id) =>
        data.slides.some((s) => s.id === id),
      );
      attempts = data.attempts
        .filter((a) => a.sessionId === session.id)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      if (resumable.progress && queue[resumable.progress.index]) {
        index = resumable.progress.index;
        draft = attempts.find(
          (a) =>
            a.id === resumable.progress!.attemptId &&
            a.slideId === queue[index],
        );
        phase = resumable.progress.phase;
        // Editing a slide must never relabel an old attempt as belonging to the new revision.
        if (
          !draft ||
          draft.slideRevision !==
            data.slides.find((s) => s.id === queue[index])?.revision
        ) {
          draft = undefined;
          phase = "recall";
        } else if (phase === "recall")
          attempts = attempts.filter((a) => a.id !== draft!.id);
      } else {
        // Backward-compatible recovery for older sessions without an explicit cursor.
        const last = attempts[attempts.length - 1];
        if (
          last &&
          !last.rating &&
          last.slideRevision ===
            data.slides.find((s) => s.id === last.slideId)?.revision
        ) {
          draft = last;
          attempts = attempts.slice(0, -1);
        }
        index = Math.min(attempts.length, queue.length);
      }
    }
    if (!queue.length) {
      setError(
        "この範囲に練習対象がありません。順番練習または別の範囲を選んでください。",
      );
      return;
    }
    if (index >= queue.length) {
      const done: Run = {
        session: { ...session, endedAt: new Date().toISOString() },
        queue,
        index: queue.length - 1,
        attempts,
        draft: attempts[attempts.length - 1] ?? newDraft(session.id, queue[0]),
        clock: { elapsedMs: 0, resumedAt: null },
        phase: "summary",
      };
      await commit(done);
      return;
    }
    draft ??= newDraft(session.id, queue[index]);
    const next: Run = {
      session,
      queue,
      index,
      attempts,
      draft,
      clock: {
        elapsedMs: draft.durationSeconds * 1000,
        resumedAt: phase === "recall" ? now() : null,
      },
      phase,
    };
    await commit(next);
  }
  async function finishSpeech() {
    if (!run || run.phase !== "recall") return;
    const clock = pauseClock(run.clock, now());
    const draft = finishAttempt(
      run.draft,
      elapsedSeconds(clock, now()),
      new Date().toISOString(),
    );
    const next: Run = {
      ...run,
      clock,
      draft,
      attempts: replaceAttempt(run.attempts, draft),
      phase: "answer",
    };
    // Keep the speaking duration frozen even if storage fails and the user must retry.
    update({ ...run, clock });
    await commit(next);
  }
  async function rate(rating: Rating) {
    if (!run || run.phase !== "rating") return;
    const draft = { ...run.draft, rating };
    const queue =
      run.session.mode === "rehearsal"
        ? run.queue
        : scheduleRetry(run.queue, run.index, rating);
    await commit({
      ...run,
      draft,
      queue,
      attempts: replaceAttempt(run.attempts, draft),
      phase: "next",
    });
  }
  async function moveNext(skip = false, previous = false) {
    if (!run) return;
    if (
      previous &&
      run.queue.filter((id) => id === run.queue[run.index - 1]).length >=
        MAX_ATTEMPTS_PER_SLIDE
    ) {
      setError(
        "このスライドは今回の練習で3回出題しています。続ける場合は新しい練習を開始してください。",
      );
      return;
    }
    if (
      skip &&
      run.session.mode !== "rehearsal" &&
      !window.confirm("このスライドは未評価で保存して移動しますか？")
    )
      return;
    const clock = pauseClock(run.clock, now());
    const draft =
      run.phase === "recall"
        ? finishAttempt(
            run.draft,
            elapsedSeconds(clock, now()),
            new Date().toISOString(),
          )
        : run.draft;
    const attempts = replaceAttempt(run.attempts, draft);
    const queue = [...run.queue];
    if (previous && run.index > 0)
      queue.splice(run.index + 1, 0, run.queue[run.index - 1]);
    const index = run.index + 1;
    if (index === queue.length) {
      await commit({
        ...run,
        attempts,
        draft,
        clock,
        session: { ...run.session, endedAt: new Date().toISOString() },
        phase: "summary",
      });
    } else {
      await commit({
        ...run,
        attempts,
        queue,
        index,
        draft: newDraft(run.session.id, queue[index]),
        clock: { elapsedMs: 0, resumedAt: now() },
        phase: "recall",
      });
    }
  }
  async function exit() {
    if (!run || run.phase === "summary") {
      if (document.fullscreenElement)
        await document.exitFullscreen().catch(() => undefined);
      onExit();
      return;
    }
    if (
      !window.confirm(
        "ここまでの記録を保存して練習を終了しますか？ 未完了の練習は続きから再開できます。",
      )
    )
      return;
    const paused = { ...run, clock: pauseClock(run.clock, now()) };
    if (await commit(paused)) {
      if (document.fullscreenElement)
        await document.exitFullscreen().catch(() => undefined);
      onExit();
    }
  }
  function hint() {
    if (
      run?.phase === "recall" &&
      (run.session.mode !== "rehearsal" || rehearsalHints)
    ) {
      const next = {
        ...run,
        draft: revealHint(run.draft, elapsedSeconds(run.clock, now())),
      };
      update(next);
      void persist(next).catch(() =>
        setError(
          "ヒントの使用記録を保存できませんでした。保存して終了をお試しください。",
        ),
      );
    }
  }
  function pause() {
    if (run?.phase !== "recall") return;
    const clock =
      run.clock.resumedAt === null
        ? resumeClock(run.clock, now())
        : pauseClock(run.clock, now());
    const next = { ...run, clock };
    update(next);
    if (clock.resumedAt === null)
      void persist(next).catch(() =>
        setError(
          "一時停止時の保存に失敗しました。保存して終了をお試しください。",
        ),
      );
  }
  async function toggleFullscreen() {
    if (fullScreen) {
      if (document.fullscreenElement)
        await document.exitFullscreen().catch(() => undefined);
      setFullScreen(false);
      return;
    }
    setFullScreen(true);
    // iOS Safari can lack or reject this API. The scoped CSS remains as a fallback.
    if (stage.current?.requestFullscreen)
      await stage.current.requestFullscreen().catch(() => undefined);
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        operation.current ||
        target.closest('input, textarea, select, [contenteditable="true"]')
      )
        return;
      if (!run || run.phase === "summary") return;
      if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        hint();
      }
      if (event.code === "Space" && target.tagName !== "BUTTON") {
        event.preventDefault();
        pause();
      }
      if (run.phase === "rating" && ["1", "2", "3"].includes(event.key)) {
        event.preventDefault();
        void rate(
          ({ "1": "good", "2": "partial", "3": "again" } as const)[
            event.key as "1" | "2" | "3"
          ],
        );
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (run.phase === "next") void moveNext();
        else if (run.phase === "answer") update({ ...run, phase: "rating" });
        else if (run.session.mode === "rehearsal") void moveNext();
      }
      if (event.key === "ArrowLeft" && run.index > 0) {
        event.preventDefault();
        void moveNext(true, true);
      }
      if (event.key === "Escape" && fullScreen) setFullScreen(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  if (!run)
    return (
      <section className="panel practice-setup stack">
        <div className="row spread">
          <h2>練習をはじめる</h2>
          <button onClick={onExit}>戻る</button>
        </div>
        <p className="muted">
          {data.project.title} ·
          原稿を隠して、スライドから話す内容を思い出しましょう。
        </p>
        {resumable && (
          <div className="notice">
            <p>保存済みの練習があります。前回保存した位置から再開します。</p>
            <button disabled={busy} onClick={() => void start(true)}>
              続きから再開
            </button>
          </div>
        )}
        <label>
          練習モード
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as PracticeMode)}
          >
            {Object.entries(modeLabels).map(([id, label]) => (
              <option value={id} key={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <label>
            開始スライド
            <input
              type="number"
              min={1}
              max={to}
              value={from}
              onChange={(e) => setFrom(Number(e.target.value))}
            />
          </label>
          <label>
            終了スライド
            <input
              type="number"
              min={from}
              max={Math.max(...data.slides.map((s) => s.pageNumber), 1)}
              value={to}
              onChange={(e) => setTo(Number(e.target.value))}
            />
          </label>
        </div>
        {mode === "weak" && (
          <p className="notice">
            現在の原稿の評価とヒント使用をもとに出題します。対象がない場合は順番練習を選んでください。
          </p>
        )}
        {mode === "rehearsal" ? (
          <p className="muted">
            スライドごとに「次のスライドへ」で時間を記録します。自己評価は終了後にまとめて行えます。
          </p>
        ) : (
          <p className="muted">
            ×は2枚後、△は終盤に再出題。1枚につき最大3回で終了します。
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <button
          className="primary"
          disabled={
            busy ||
            !Number.isInteger(from) ||
            !Number.isInteger(to) ||
            from < 1 ||
            to < from
          }
          onClick={() => void start()}
        >
          練習を開始
        </button>
      </section>
    );

  const seconds = elapsedSeconds(run.clock, now());
  const hintLevel = Math.max(0, ...run.draft.hintsUsed.map((h) => h.level));
  if (run.phase === "summary")
    return (
      <section className="panel stack practice-summary">
        <h2>練習おつかれさまでした</h2>
        <p>
          {modeLabels[run.session.mode]} · {run.attempts.length}回の想起 ·
          発話時間{" "}
          {formatDuration(
            run.attempts.reduce((sum, a) => sum + a.durationSeconds, 0),
          )}
        </p>
        <p className="muted">
          評価はご自身の振り返りです。未評価のスライドもここで記録できます。
        </p>
        {error && <p role="alert">{error}</p>}
        {run.attempts.map((attempt) => (
          <div className="practice-summary-row" key={attempt.id}>
            <span>
              スライド{" "}
              {data.slides.find((s) => s.id === attempt.slideId)?.pageNumber} ·{" "}
              {formatDuration(attempt.durationSeconds)} · ヒント{" "}
              {Math.max(0, ...attempt.hintsUsed.map((h) => h.level))}
            </span>
            <div className="row">
              {(Object.keys(ratingLabels) as Rating[]).map((rating) => (
                <button
                  key={rating}
                  disabled={busy}
                  aria-pressed={attempt.rating === rating}
                  onClick={() =>
                    void commit({
                      ...run,
                      attempts: replaceAttempt(run.attempts, {
                        ...attempt,
                        rating,
                      }),
                    })
                  }
                >
                  {ratingLabels[rating]}
                </button>
              ))}
            </div>
          </div>
        ))}
        <button className="primary" disabled={busy} onClick={() => void exit()}>
          保存した結果を見る
        </button>
      </section>
    );

  return (
    <section
      ref={stage}
      className={`practice-stage ${fullScreen ? "practice-fullscreen" : ""}`}
    >
      <header className="practice-header">
        <div>
          <span className="eyebrow">
            {modeLabels[run.session.mode]} · {run.index + 1}/{run.queue.length}
          </span>
          <h2 data-testid="practice-slide-number">
            スライド {current?.pageNumber}
          </h2>
        </div>
        <div className="row">
          <span className="practice-timer" aria-label="経過時間">
            {formatDuration(seconds)}
          </span>
          <button onClick={() => void toggleFullscreen()}>
            {fullScreen ? "全画面を終了" : "全画面"}
          </button>
          <button disabled={busy} onClick={() => void exit()}>
            保存して終了
          </button>
        </div>
      </header>
      <div className="practice-steps" aria-label="練習の進行">
        <span aria-current={run.phase === "recall" ? "step" : undefined}>
          1 想起中
        </span>
        <span aria-current={run.phase === "answer" ? "step" : undefined}>
          2 答え合わせ
        </span>
        <span aria-current={run.phase === "rating" ? "step" : undefined}>
          3 自己評価
        </span>
        <span aria-current={run.phase === "next" ? "step" : undefined}>
          4 次へ
        </span>
      </div>
      <div className="practice-slide">
        <PdfSlide
          assetId={data.project.pdfAssetId}
          pageNumber={current?.pageNumber ?? 1}
        />
      </div>
      {error && <p role="alert">{error}</p>}
      {current && (run.phase !== "recall" || hintLevel > 0) && (
        <aside className="panel practice-script" aria-live="polite">
          <h3>
            {run.phase === "recall"
              ? `ヒント ${hintLevel}/3`
              : "答え合わせ（ヒント使用には含みません）"}
          </h3>
          {(run.phase !== "recall" || hintLevel >= 1) && (
            <div>
              <strong>説明ポイント</strong>
              {current.keyPoints.length ? (
                <ol>
                  {current.keyPoints.map((point) => (
                    <li key={point.id}>
                      {point.text}
                      {point.required ? "（必須）" : ""}
                    </li>
                  ))}
                </ol>
              ) : (
                <p>未設定</p>
              )}
            </div>
          )}
          {(run.phase !== "recall" || hintLevel >= 2) && (
            <p>
              <strong>冒頭アンカー</strong>
              <br />
              {current.openingExact || "未設定"}
            </p>
          )}
          {(run.phase !== "recall" || hintLevel >= 3) && (
            <>
              <strong>原稿全文</strong>
              <p className="script-text">
                {current.fullScript || "原稿は未設定です"}
              </p>
            </>
          )}
          {run.phase !== "recall" && (
            <>
              <p>
                <strong>締めアンカー</strong>
                <br />
                {current.closingExact || "未設定"}
              </p>
              <p>
                <strong>次への接続</strong>
                <br />
                {current.transitionToNext || "未設定"}
              </p>
            </>
          )}
        </aside>
      )}
      <footer className="panel practice-controls">
        {run.phase === "recall" && (
          <>
            <div className="row spread">
              <span className="practice-status">
                {hintLevel === 0
                  ? "原稿は非表示です"
                  : `ヒント ${hintLevel}/3 を表示中`}
                {run.clock.resumedAt === null ? " · 一時停止中" : ""}
              </span>
              {current?.targetSeconds && (
                <span className="muted">
                  目標 {formatDuration(current.targetSeconds)}
                </span>
              )}
            </div>
            <div className="row">
              <button disabled={busy} onClick={pause}>
                {run.clock.resumedAt === null ? "タイマーを再開" : "一時停止"}
              </button>
              {run.session.mode === "rehearsal" && !rehearsalHints ? (
                <button onClick={() => setRehearsalHints(true)}>
                  ヒント操作を有効にする
                </button>
              ) : (
                <button disabled={hintLevel >= 3 || busy} onClick={hint}>
                  ヒントを表示
                </button>
              )}
              {run.session.mode === "rehearsal" ? (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void moveNext()}
                >
                  {run.index + 1 === run.queue.length
                    ? "リハーサルを終了"
                    : "次のスライドへ"}
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void finishSpeech()}
                >
                  発話を終えて答え合わせ
                </button>
              )}
            </div>
          </>
        )}
        {run.phase === "answer" && (
          <div className="row">
            <p>
              必須ポイントとアンカーを確認して、再現できたか振り返りましょう。
            </p>
            <button
              className="primary"
              onClick={() => update({ ...run, phase: "rating" })}
            >
              自己評価へ
            </button>
          </div>
        )}
        {run.phase === "rating" && (
          <>
            <p>
              ◎の目安：ヒントなしで必須の内容と指定アンカーを再現。機械による正誤判定は行いません。
            </p>
            {hintLevel > 0 && (
              <p className="notice">
                今回はヒントを使用しています。自力で再現できた範囲を振り返って評価してください。
              </p>
            )}
            <div className="row">
              {(Object.keys(ratingLabels) as Rating[]).map((rating, i) => (
                <button
                  aria-label={ratingLabels[rating]}
                  className={`rating rating-${rating}`}
                  key={rating}
                  disabled={busy}
                  onClick={() => void rate(rating)}
                >
                  {ratingLabels[rating]}
                  <small aria-hidden="true">{i + 1}</small>
                </button>
              ))}
            </div>
          </>
        )}
        {run.phase === "next" && (
          <div className="row spread">
            <p>
              {run.draft.rating && ratingLabels[run.draft.rating]} · 保存済み
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void moveNext()}
            >
              {run.index + 1 === run.queue.length ? "結果を見る" : "次へ"}
            </button>
          </div>
        )}
        <div className="row spread practice-navigation">
          <button
            disabled={busy || run.index === 0}
            onClick={() => void moveNext(true, true)}
          >
            前のスライドを練習
          </button>
          {run.phase !== "next" && run.session.mode !== "rehearsal" && (
            <button disabled={busy} onClick={() => void moveNext(true)}>
              未評価で次へ
            </button>
          )}
          <small className="muted">
            H：ヒント · Space：一時停止 · 1/2/3：評価 · ←/→：移動
          </small>
        </div>
      </footer>
    </section>
  );
}
