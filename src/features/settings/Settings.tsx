import { useEffect, useState } from "react";
import {
  exportAll,
  importCopies,
  listProjects,
  deleteProject,
} from "../../lib/storage";
import { exportBackup, importBackup } from "../../lib/backup";
import type { Project } from "../../domain/types";
export function Settings({ onChanged }: { onChanged: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [estimate, setEstimate] = useState<StorageEstimate>();
  const [persisted, setPersisted] = useState<boolean>();
  async function refresh() {
    setProjects(await listProjects());
    if (navigator.storage?.estimate)
      setEstimate(await navigator.storage.estimate());
    if (navigator.storage?.persisted)
      setPersisted(await navigator.storage.persisted());
  }
  useEffect(() => {
    void refresh().catch(() => setError("保存領域を確認できません。"));
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      await refresh();
      onChanged();
    } catch {
      setError(
        "処理できませんでした。復元時は正常なSlideRecallのZIP（256 MB以内）を選び、保存領域の空き容量も確認してください。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    const blob = await exportBackup(await exportAll());
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `SlideRecall-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setMessage("ZIPを作成しました。ダウンロード先を確認してください。");
  }
  return (
    <section className="settings stack">
      <div>
        <p className="eyebrow">KEEP YOUR PROGRESS</p>
        <h1>設定・バックアップ</h1>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <div className="panel stack">
        <h2>練習の記録を手元に残す</h2>
        <p>
          PDF・原稿・練習履歴をまとめて保存します。ZIPは暗号化されません。保存場所と共有先にご注意ください。
        </p>
        <div className="row">
          <button
            className="primary"
            disabled={busy}
            onClick={() => void run(download)}
          >
            ZIPを保存
          </button>
          <label className="file-button">
            ZIPバックアップを復元
            <input
              aria-label="ZIPバックアップを復元"
              type="file"
              accept=".zip,application/zip"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file)
                  void run(async () => {
                    const items = await importBackup(file);
                    await importCopies(items);
                    setMessage(
                      `${items.length}件をコピーとして復元しました。既存の発表は保持しています。`,
                    );
                  });
              }}
            />
          </label>
        </div>
        <p className="muted">
          復元すると新しい発表が追加されます。既存データを上書きしません。
        </p>
      </div>
      <div className="panel stack">
        <h2>このブラウザの保存領域</h2>
        <p>
          {estimate
            ? `使用量 約${((estimate.usage || 0) / 1024 / 1024).toFixed(1)} MB / 利用可能な容量の目安 約${((estimate.quota || 0) / 1024 / 1024).toFixed(0)} MB`
            : "容量表示はこのブラウザでは利用できません。"}
        </p>
        <p>
          {persisted
            ? "永続保存が許可されています。バックアップも続けてください。"
            : "ブラウザの判断や空き容量によって、保存データが削除される場合があります。"}
        </p>
        <button
          disabled={busy || !navigator.storage?.persist}
          onClick={() =>
            void run(async () => {
              const ok = await navigator.storage.persist();
              setMessage(
                ok
                  ? "永続保存が許可されました。"
                  : "永続保存は許可されませんでした。定期的にZIPを保存してください。",
              );
            })
          }
        >
          データの保持を申請
        </button>
        <p className="muted">
          端末・ブラウザ・ホーム画面のPWAの間では自動同期されません。プライベートブラウズや閲覧データの削除にもご注意ください。
        </p>
      </div>
      <div className="panel stack">
        <h2>ローカル保存とプライバシー</h2>
        <p>
          PDF・原稿・練習履歴をアップロードする機能はありません。アプリの読み込み・更新時には配信元へ通信し、GitHub側にアクセスログが残る場合があります。
        </p>
        <p>
          ローカル保存は暗号化ではありません。同じ satorumuro.github.io
          上のサイトとは保存領域へのアクセス権限を共有します。機密性が高い用途では専用サブドメインをご検討ください。端末やブラウザ拡張からのアクセスは防げません。
        </p>
      </div>
      <div className="panel stack">
        <h2>発表を削除</h2>
        {projects.length ? (
          projects.map((p) => (
            <div className="section-heading" key={p.id}>
              <span>{p.title}</span>
              <button
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "この発表とPDF・原稿・練習履歴を削除します。元に戻せません。削除しますか？",
                    )
                  )
                    void run(async () => {
                      await deleteProject(p.id);
                      setMessage("発表を削除しました。");
                    });
                }}
              >
                削除
              </button>
            </div>
          ))
        ) : (
          <p className="muted">保存された発表はありません。</p>
        )}
      </div>
    </section>
  );
}
