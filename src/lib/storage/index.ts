import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  BackupProject,
  PracticeAttempt,
  PracticeSession,
  Project,
  ProjectData,
  Slide,
} from "../../domain/types";

interface RecallDB extends DBSchema {
  projects: { key: string; value: Project };
  slides: { key: string; value: Slide; indexes: { projectId: string } };
  pdfs: { key: string; value: { id: string; blob: Blob } };
  sessions: {
    key: string;
    value: PracticeSession;
    indexes: { projectId: string };
  };
  attempts: {
    key: string;
    value: PracticeAttempt;
    indexes: { sessionId: string; slideId: string };
  };
}

export const DATABASE_NAME = "sliderecall-local";
export const DATABASE_VERSION = 2;
let connection: Promise<IDBPDatabase<RecallDB>> | undefined;
const pdfCache = new Map<string, Promise<Blob | undefined>>();

function database() {
  connection ??= openDB<RecallDB>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        db.createObjectStore("projects", { keyPath: "id" });
        db.createObjectStore("slides", { keyPath: "id" });
        db.createObjectStore("pdfs", { keyPath: "id" });
        db.createObjectStore("sessions", { keyPath: "id" });
        db.createObjectStore("attempts", { keyPath: "id" });
      }
      // Additive migration: retain all v1 data when adding lookup indexes.
      if (oldVersion < 2) {
        tx.objectStore("slides").createIndex("projectId", "projectId");
        tx.objectStore("sessions").createIndex("projectId", "projectId");
        tx.objectStore("attempts").createIndex("sessionId", "sessionId");
        tx.objectStore("attempts").createIndex("slideId", "slideId");
      }
    },
    blocking() {
      void closeStorage();
    },
    terminated() {
      connection = undefined;
      pdfCache.clear();
    },
  }).catch(() => {
    connection = undefined;
    throw new Error(
      "端末の保存領域を開けません。ブラウザの保存設定や空き容量を確認してください。",
    );
  });
  return connection;
}

export async function closeStorage() {
  const current = connection;
  connection = undefined;
  pdfCache.clear();
  if (current) (await current).close();
}

export function storageError(error: unknown): string {
  if (error instanceof DOMException && error.name === "QuotaExceededError")
    return "保存容量が不足しています。バックアップを保存し、不要な発表を削除してください。";
  return "端末への保存に失敗しました。空き容量やブラウザの保存設定を確認して再試行してください。";
}

export async function listProjects(): Promise<Project[]> {
  return (await (await database()).getAll("projects")).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export async function loadProject(id: string): Promise<ProjectData> {
  const db = await database();
  const tx = db.transaction(
    ["projects", "slides", "sessions", "attempts"],
    "readonly",
  );
  const [project, slides, sessions] = await Promise.all([
    tx.objectStore("projects").get(id),
    tx.objectStore("slides").index("projectId").getAll(id),
    tx.objectStore("sessions").index("projectId").getAll(id),
  ]);
  if (!project) throw new Error("この発表は見つかりません。");
  const attempts = (
    await Promise.all(
      sessions.map((session) =>
        tx.objectStore("attempts").index("sessionId").getAll(session.id),
      ),
    )
  ).flat();
  await tx.done;
  return {
    project,
    slides: slides.sort((a, b) => a.pageNumber - b.pageNumber),
    sessions: sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    attempts: attempts.sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
  };
}

export async function getPdf(assetId: string): Promise<Blob | undefined> {
  if (!pdfCache.has(assetId)) {
    const pending = database()
      .then((db) => db.get("pdfs", assetId))
      .then((item) => item?.blob);
    pdfCache.set(assetId, pending);
    void pending.catch(() => pdfCache.delete(assetId));
    // Retain only a few recent PDFs; Blob reads are avoided during page navigation.
    if (pdfCache.size > 3) pdfCache.delete(pdfCache.keys().next().value!);
  }
  return pdfCache.get(assetId);
}

export async function saveProject(
  data: ProjectData,
  pdf?: Blob,
): Promise<void> {
  if (pdf && !data.project.pdfAssetId)
    throw new Error("PDFの保存先IDがありません。");
  const db = await database();
  const tx = db.transaction(
    ["projects", "slides", "pdfs", "sessions", "attempts"],
    "readwrite",
  );
  const writes: Promise<unknown>[] = [
    tx.objectStore("projects").put(data.project),
  ];
  data.slides.forEach((slide) =>
    writes.push(tx.objectStore("slides").put(slide)),
  );
  data.sessions.forEach((session) =>
    writes.push(tx.objectStore("sessions").put(session)),
  );
  data.attempts.forEach((attempt) =>
    writes.push(tx.objectStore("attempts").put(attempt)),
  );
  if (pdf)
    writes.push(
      tx.objectStore("pdfs").put({ id: data.project.pdfAssetId!, blob: pdf }),
    );
  await Promise.all([...writes, tx.done]);
  if (pdf) pdfCache.set(data.project.pdfAssetId!, Promise.resolve(pdf));
}

export async function saveSlide(slide: Slide): Promise<void> {
  const tx = (await database()).transaction(
    ["projects", "slides"],
    "readwrite",
  );
  const project = await tx.objectStore("projects").get(slide.projectId);
  if (!project) {
    await tx.done;
    throw new Error("この発表は見つかりません。");
  }
  await Promise.all([
    tx.objectStore("slides").put(slide),
    tx
      .objectStore("projects")
      .put({ ...project, updatedAt: new Date().toISOString() }),
    tx.done,
  ]);
}

export async function saveSession(
  session: PracticeSession,
  attempts: PracticeAttempt[],
): Promise<void> {
  const tx = (await database()).transaction(
    ["projects", "sessions", "attempts"],
    "readwrite",
  );
  const project = await tx.objectStore("projects").get(session.projectId);
  if (!project) {
    await tx.done;
    throw new Error("この発表は見つかりません。");
  }
  await Promise.all([
    tx.objectStore("sessions").put(session),
    tx
      .objectStore("projects")
      .put({ ...project, updatedAt: new Date().toISOString() }),
    ...attempts.map((attempt) => tx.objectStore("attempts").put(attempt)),
    tx.done,
  ]);
}

export async function deleteProject(id: string): Promise<void> {
  const tx = (await database()).transaction(
    ["projects", "slides", "pdfs", "sessions", "attempts"],
    "readwrite",
  );
  const project = await tx.objectStore("projects").get(id);
  const [slides, sessions] = await Promise.all([
    tx.objectStore("slides").index("projectId").getAllKeys(id),
    tx.objectStore("sessions").index("projectId").getAllKeys(id),
  ]);
  const attempts = (
    await Promise.all(
      sessions.map((sessionId) =>
        tx.objectStore("attempts").index("sessionId").getAllKeys(sessionId),
      ),
    )
  ).flat();
  await Promise.all([
    tx.objectStore("projects").delete(id),
    ...slides.map((key) => tx.objectStore("slides").delete(key)),
    ...sessions.map((key) => tx.objectStore("sessions").delete(key)),
    ...attempts.map((key) => tx.objectStore("attempts").delete(key)),
    ...(project?.pdfAssetId
      ? [tx.objectStore("pdfs").delete(project.pdfAssetId)]
      : []),
    tx.done,
  ]);
  if (project?.pdfAssetId) pdfCache.delete(project.pdfAssetId);
}

export async function exportAll(): Promise<BackupProject[]> {
  const tx = (await database()).transaction(
    ["projects", "slides", "pdfs", "sessions", "attempts"],
    "readonly",
  );
  const [projects, slides, pdfs, sessions, attempts] = await Promise.all([
    tx.objectStore("projects").getAll(),
    tx.objectStore("slides").getAll(),
    tx.objectStore("pdfs").getAll(),
    tx.objectStore("sessions").getAll(),
    tx.objectStore("attempts").getAll(),
  ]);
  await tx.done;
  return projects.map((project) => {
    const ownSessions = sessions.filter(
      (session) => session.projectId === project.id,
    );
    const sessionIds = new Set(ownSessions.map((session) => session.id));
    return {
      project,
      slides: slides.filter((slide) => slide.projectId === project.id),
      sessions: ownSessions,
      attempts: attempts.filter((attempt) => sessionIds.has(attempt.sessionId)),
      pdf: pdfs.find((pdf) => pdf.id === project.pdfAssetId)?.blob,
    };
  });
}

export async function importCopies(items: BackupProject[]): Promise<void> {
  const copies = items.map((item) => {
    const projectId = crypto.randomUUID();
    const slideIds = new Map(
      item.slides.map((slide) => [slide.id, crypto.randomUUID()]),
    );
    const sessionIds = new Map(
      item.sessions.map((session) => [session.id, crypto.randomUUID()]),
    );
    const attemptIds = new Map(
      item.attempts.map((attempt) => [attempt.id, crypto.randomUUID()]),
    );
    const project = {
      ...item.project,
      id: projectId,
      title: `${item.project.title.slice(0, 496)}（復元）`,
      pdfAssetId: item.pdf ? crypto.randomUUID() : undefined,
      updatedAt: new Date().toISOString(),
    };
    return {
      project,
      pdf: item.pdf,
      slides: item.slides.map((slide) => ({
        ...slide,
        id: slideIds.get(slide.id)!,
        projectId,
        keyPoints: slide.keyPoints.map((point) => ({
          ...point,
          id: crypto.randomUUID(),
        })),
      })),
      sessions: item.sessions.map((session) => ({
        ...session,
        id: sessionIds.get(session.id)!,
        projectId,
        slideIds: session.slideIds.map((id) => slideIds.get(id)!),
        progress: session.progress
          ? {
              ...session.progress,
              attemptId: attemptIds.get(session.progress.attemptId)!,
            }
          : undefined,
      })),
      attempts: item.attempts.map((attempt) => ({
        ...attempt,
        id: attemptIds.get(attempt.id)!,
        sessionId: sessionIds.get(attempt.sessionId)!,
        slideId: slideIds.get(attempt.slideId)!,
      })),
    };
  });
  const tx = (await database()).transaction(
    ["projects", "slides", "pdfs", "sessions", "attempts"],
    "readwrite",
  );
  const writes: Promise<unknown>[] = [];
  copies.forEach((item) => {
    writes.push(tx.objectStore("projects").add(item.project));
    item.slides.forEach((slide) =>
      writes.push(tx.objectStore("slides").add(slide)),
    );
    item.sessions.forEach((session) =>
      writes.push(tx.objectStore("sessions").add(session)),
    );
    item.attempts.forEach((attempt) =>
      writes.push(tx.objectStore("attempts").add(attempt)),
    );
    if (item.pdf)
      writes.push(
        tx
          .objectStore("pdfs")
          .add({ id: item.project.pdfAssetId!, blob: item.pdf }),
      );
  });
  await Promise.all([...writes, tx.done]);
}
