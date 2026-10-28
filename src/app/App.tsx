import { useCallback, useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { listProjects, loadProject } from "../lib/storage";
import type { ProjectData, PracticeMode } from "../domain/types";
import { ImportWizard } from "../features/import/ImportWizard";
import { Editor } from "../features/editor/Editor";
import { Practice } from "../features/practice/Practice";
import { Stats } from "../features/stats/Stats";
import { Settings } from "../features/settings/Settings";
type View = "home" | "import" | "editor" | "practice" | "stats" | "settings";
export function App() {
  const [view, setView] = useState<View>("home");
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [data, setData] = useState<ProjectData>();
  const [mode, setMode] = useState<PracticeMode>("sequential");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("sliderecall-theme") || "light";
    } catch {
      return "light";
    }
  });
  const [online, setOnline] = useState(navigator.onLine);
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW();
  const refresh = useCallback(async () => {
    try {
      const list = await listProjects();
      setProjects(await Promise.all(list.map((p) => loadProject(p.id))));
      setError("");
    } catch {
      setError(
        "このブラウザの保存領域を開けません。プライベートブラウズや保存設定、空き容量を確認してください。",
      );
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("sliderecall-theme", theme);
    } catch {
      /* theme is optional */
    }
  }, [theme]);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  async function open(
    id: string,
    target: View,
    practiceMode: PracticeMode = "sequential",
  ) {
    try {
      setData(await loadProject(id));
      setMode(practiceMode);
      setView(target);
      window.scrollTo(0, 0);
    } catch {
      setError("発表を読み込めません。もう一度お試しください。");
    }
  }
  function home() {
    setView("home");
    setData(undefined);
    void refresh();
  }
  const focused = view === "practice" || view === "editor" || view === "import";
  return (
    <>
      <header className="app-header">
        <button
          className="brand"
          onClick={() => {
            if (!focused) home();
          }}
          disabled={focused}
        >
          <img
            src={`${import.meta.env.BASE_URL}icon.svg`}
            width="32"
            height="32"
            alt=""
          />
          <span>
            SlideRecall<small>発表を、自分の言葉で。</small>
          </span>
        </button>
        <nav aria-label="メインナビゲーション">
          <span className="local-status">
            <i />
            {online ? "このブラウザに保存" : "オフライン"}
          </span>
          {!focused && (
            <button
              className={view === "home" ? "nav-active" : ""}
              onClick={home}
            >
              発表一覧
            </button>
          )}
          {!focused && (
            <button
              className={view === "settings" ? "nav-active" : ""}
              onClick={() => setView("settings")}
            >
              設定・バックアップ
            </button>
          )}
          <button
            aria-label={
              theme === "light" ? "ダークテーマに切替" : "ライトテーマに切替"
            }
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            {theme === "light" ? "◐" : "◑"}
          </button>
        </nav>
      </header>
      <main
        className={view === "practice" ? "app-main practice-main" : "app-main"}
      >
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {needRefresh && (
          <div className="notice row" role="status">
            <span>
              新しいバージョンがあります。作業を終えてから更新できます。
            </span>
            <button
              disabled={focused}
              onClick={() => void updateServiceWorker(true)}
            >
              更新して再読み込み
            </button>
          </div>
        )}
        {view === "home" && (
          <>
            <section className="hero">
              <div>
                <p className="eyebrow">YOUR PRESENTATIONS</p>
                <h1>
                  スライドを見て、
                  <br />
                  自分の言葉で話す。
                </h1>
                <p>
                  思い出す。確かめる。もう一度。
                  <br />
                  次の発表まで、少しずつ自信を重ねましょう。
                </p>
                <button
                  className="primary"
                  disabled={!loaded || !!error}
                  onClick={() => setView("import")}
                >
                  ＋ 新しい発表を追加
                </button>
              </div>
              <div className="hero-visual" aria-hidden="true">
                <div className="illustration-slide">
                  <span>01 / RECALL</span>
                  <div />
                  <div />
                  <strong>
                    話すことを、
                    <br />
                    思い出す。
                  </strong>
                  <i>● ● ○</i>
                </div>
                <span className="illustration-note">
                  原稿を閉じて、ひと呼吸。
                </span>
              </div>
            </section>
            <div className="section-heading">
              <h2>
                あなたの発表 <span className="count">{projects.length}</span>
              </h2>
              <span className="muted">同期なし・バックアップを忘れずに</span>
            </div>
            {!loaded ? (
              <p role="status">保存データを読み込み中…</p>
            ) : projects.length ? (
              <div className="project-grid">
                {projects.map((item) => {
                  const p = item.project;
                  const attempts = item.attempts;
                  const last = [...attempts].sort((a, b) =>
                    b.finishedAt.localeCompare(a.finishedAt),
                  )[0];
                  const mastered = item.slides.filter(
                    (s) =>
                      [...attempts]
                        .filter(
                          (a) =>
                            a.slideId === s.id &&
                            a.slideRevision === s.revision,
                        )
                        .sort((a, b) =>
                          b.finishedAt.localeCompare(a.finishedAt),
                        )[0]?.rating === "good",
                  ).length;
                  return (
                    <article className="project-card" key={p.id}>
                      <div className="card-top">
                        <span className="badge">{p.pageCount} SLIDES</span>
                        <span className="muted">
                          {p.pdfAssetId ? "PDF" : "原稿のみ"}
                        </span>
                      </div>
                      <h3>{p.title}</h3>
                      <p className="muted">
                        最終練習{" "}
                        {last
                          ? new Date(last.finishedAt).toLocaleDateString(
                              "ja-JP",
                            )
                          : "まだ練習していません"}
                      </p>
                      <div className="mastery">
                        <span>現在の原稿でスムーズ</span>
                        <strong>
                          {mastered}
                          <small> / {item.slides.length}</small>
                        </strong>
                      </div>
                      <progress
                        value={mastered}
                        max={item.slides.length}
                        aria-label="習得状況"
                      />
                      {item.slides.some((s) => !s.fullScript.trim()) && (
                        <p className="muted">
                          原稿が未設定のスライドがあります
                        </p>
                      )}
                      <button
                        className="primary"
                        onClick={() => void open(p.id, "practice")}
                      >
                        続きから練習
                      </button>
                      <div className="card-actions">
                        <button onClick={() => void open(p.id, "editor")}>
                          原稿を編集
                        </button>
                        <button onClick={() => void open(p.id, "stats")}>
                          結果を見る
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-icon">＋</span>
                <h3>最初の発表を追加しましょう</h3>
                <p>
                  PDFと「Slide 1:」形式の原稿を用意すれば、すぐに始められます。
                </p>
              </div>
            )}
            <aside className="privacy-strip">
              <span>◇</span>
              <div>
                <strong>発表資料は、このブラウザの中に。</strong>
                <p>
                  PDF・原稿・練習履歴は端末内に保存します。端末間の同期はありません。設定からZIPを保存できます。
                </p>
              </div>
            </aside>
          </>
        )}
        {view === "import" && (
          <ImportWizard
            onComplete={(id) => {
              void refresh();
              void open(id, "editor");
            }}
            onCancel={home}
          />
        )}
        {view === "editor" && data && (
          <Editor key={data.project.id} data={data} onExit={home} />
        )}
        {view === "practice" && data && (
          <Practice
            key={data.project.id}
            data={data}
            initialMode={mode}
            onExit={() => {
              void refresh();
              void open(data.project.id, "stats");
            }}
          />
        )}
        {view === "stats" && data && (
          <Stats
            data={data}
            onPractice={(m) => void open(data.project.id, "practice", m)}
            onRefresh={() => void open(data.project.id, "stats")}
          />
        )}
        {view === "settings" && <Settings onChanged={() => void refresh()} />}
      </main>
      <footer className="app-footer">
        <span>
          SlideRecall <span className="muted">v0.1</span>
        </span>
        <span>
          {offlineReady
            ? "オフラインの準備ができました"
            : "資料はブラウザ内に保存・定期的にバックアップ"}
        </span>
      </footer>
    </>
  );
}
