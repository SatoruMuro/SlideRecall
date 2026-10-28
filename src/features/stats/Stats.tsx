import { useState } from "react";
import type {
  PracticeAttempt,
  PracticeMode,
  ProjectData,
  Rating,
} from "../../domain/types";
import { modeLabels, ratingLabels } from "../../domain/types";
import { saveSession } from "../../lib/storage";
import { currentAttempts, formatDuration, weakness } from "../practice/engine";
import "../practice/practice.css";

type Props = {
  data: ProjectData;
  onPractice: (mode: PracticeMode) => void;
  onRefresh: () => void;
};
const date = (value?: string) =>
  value
    ? new Date(value).toLocaleString("ja-JP", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "未実施";
const maxHint = (attempts: PracticeAttempt[]) =>
  attempts.reduce(
    (max, attempt) =>
      attempt.hintsUsed.reduce(
        (level, hint) => Math.max(level, hint.level),
        max,
      ),
    0,
  );
function Distribution({ attempts }: { attempts: PracticeAttempt[] }) {
  const counts = (Object.keys(ratingLabels) as Rating[]).map((rating) => ({
    rating,
    count: attempts.filter((a) => a.rating === rating).length,
  }));
  const title = counts
    .map((c) => `${ratingLabels[c.rating]} ${c.count}回`)
    .join(" / ");
  return (
    <div>
      <div className="stats-bars" role="img" aria-label={title}>
        {counts.map((c) => (
          <span className={c.rating} style={{ flex: c.count }} key={c.rating} />
        ))}
      </div>
      <p className="muted">
        {title} · 未評価 {attempts.filter((a) => !a.rating).length}回
      </p>
    </div>
  );
}

export function Stats({ data, onPractice, onRefresh }: Props) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const current = data.slides.flatMap((slide) =>
    currentAttempts(slide, data.attempts),
  );
  const weak = data.slides.filter(
    (slide) => weakness(slide, data.attempts) > 0,
  );
  const sessions = [...data.sessions].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
  async function rate(attempt: PracticeAttempt, rating: Rating) {
    const session = data.sessions.find((s) => s.id === attempt.sessionId);
    if (!session || busy) return;
    setBusy(true);
    setError("");
    try {
      await saveSession(
        session,
        data.attempts
          .filter((a) => a.sessionId === session.id)
          .map((a) => (a.id === attempt.id ? { ...a, rating } : a)),
      );
      onRefresh();
    } catch {
      setError(
        "評価を保存できませんでした。空き容量やブラウザの保存設定を確認してください。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="stack">
      <div className="row spread">
        <div>
          <span className="eyebrow">ふりかえり</span>
          <h2>{data.project.title}</h2>
        </div>
        <button
          className="primary"
          onClick={() => onPractice(weak.length ? "weak" : "sequential")}
        >
          {weak.length ? `苦手な${weak.length}枚を練習` : "順番に練習する"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="panel">
        <h3>現在の原稿での評価</h3>
        <Distribution attempts={current} />
        <p className="muted">
          自己評価の集計です。原稿を編集すると版が変わり、編集前の評価は過去の記録として残ります。
        </p>
      </div>
      <div className="panel">
        <h3>スライドごとの記録</h3>
        <div className="stats-table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th scope="col">スライド / 版</th>
                <th scope="col">◎ / △ / ×</th>
                <th scope="col">直近の評価</th>
                <th scope="col">練習回数</th>
                <th scope="col">ヒント最大</th>
                <th scope="col">直近の時間</th>
                <th scope="col">最終練習</th>
                <th scope="col">同じ版での変化</th>
              </tr>
            </thead>
            <tbody>
              {[...data.slides]
                .sort((a, b) => a.pageNumber - b.pageNumber)
                .map((slide) => {
                  const history = currentAttempts(slide, data.attempts);
                  const last = history[history.length - 1];
                  const previous = history[history.length - 2];
                  const old = data.attempts.filter(
                    (a) =>
                      a.slideId === slide.id &&
                      a.slideRevision !== slide.revision,
                  ).length;
                  return (
                    <tr key={slide.id}>
                      <th scope="row">
                        {slide.pageNumber} / v{slide.revision}
                        {old > 0 && (
                          <small className="muted"> · 旧版 {old}回</small>
                        )}
                      </th>
                      <td>
                        {(["good", "partial", "again"] as Rating[])
                          .map(
                            (r) => history.filter((a) => a.rating === r).length,
                          )
                          .join(" / ")}
                      </td>
                      <td>
                        {last?.rating
                          ? ratingLabels[last.rating]
                          : last
                            ? "未評価"
                            : "—"}
                      </td>
                      <td>{history.length}</td>
                      <td>{maxHint(history)}</td>
                      <td>
                        {last ? formatDuration(last.durationSeconds) : "—"}
                      </td>
                      <td>{date(last?.finishedAt)}</td>
                      <td>
                        {previous && last
                          ? `${previous.rating ? ratingLabels[previous.rating].split(" ")[0] : "未評価"} → ${last.rating ? ratingLabels[last.rating].split(" ")[0] : "未評価"} / ヒント ${maxHint([previous])} → ${maxHint([last])}`
                          : "比較する記録がありません"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <h3>セッション履歴</h3>
        {sessions.length === 0 && (
          <p className="muted">
            まだ練習記録はありません。まずは1枚から始めましょう。
          </p>
        )}
        {sessions.map((session) => {
          const attempts = data.attempts
            .filter((a) => a.sessionId === session.id)
            .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
          return (
            <details className="stats-session" key={session.id}>
              <summary>
                {date(session.startedAt)} · {modeLabels[session.mode]} ·{" "}
                {session.endedAt ? "完了" : "途中で保存"} · 発話{" "}
                {formatDuration(
                  attempts.reduce((sum, a) => sum + a.durationSeconds, 0),
                )}
              </summary>
              <p className="muted">
                開始 {date(session.startedAt)} / 終了{" "}
                {session.endedAt ? date(session.endedAt) : "未終了"}
              </p>
              <p>
                対象：
                {[...new Set(session.slideIds)]
                  .map((id) => data.slides.find((s) => s.id === id)?.pageNumber)
                  .filter(Boolean)
                  .join("、")}
              </p>
              <Distribution attempts={attempts} />
              {attempts.map((attempt, index) => {
                const slide = data.slides.find((s) => s.id === attempt.slideId);
                return (
                  <div className="practice-summary-row" key={attempt.id}>
                    <span>
                      {index + 1}. スライド {slide?.pageNumber ?? "—"} · v
                      {attempt.slideRevision}
                      {slide?.revision !== attempt.slideRevision
                        ? "（編集前）"
                        : ""}{" "}
                      · {formatDuration(attempt.durationSeconds)} · ヒント{" "}
                      {maxHint([attempt])}
                    </span>
                    <label>
                      スライド {slide?.pageNumber} の評価
                      <select
                        value={attempt.rating ?? ""}
                        disabled={busy}
                        onChange={(e) => {
                          if (e.target.value)
                            void rate(attempt, e.target.value as Rating);
                        }}
                      >
                        <option value="" disabled>
                          未評価
                        </option>
                        {Object.entries(ratingLabels).map(([value, label]) => (
                          <option value={value} key={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                );
              })}
            </details>
          );
        })}
      </div>
    </section>
  );
}
