// @vitest-environment node
import "fake-indexeddb/auto";
import { deleteDB, openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BackupProject } from "../../domain/types";
import {
  closeStorage,
  DATABASE_NAME,
  deleteProject,
  exportAll,
  getPdf,
  importCopies,
  listProjects,
  loadProject,
  saveProject,
  saveSession,
  saveSlide,
} from "./index";

const now = "2026-10-28T00:00:00.000Z";
function fixture(): BackupProject {
  const projectId = crypto.randomUUID();
  const slideId = crypto.randomUUID();
  return {
    project: {
      id: projectId,
      title: "Synthetic",
      pdfAssetId: crypto.randomUUID(),
      pageCount: 1,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
    },
    slides: [
      {
        id: slideId,
        projectId,
        pageNumber: 1,
        revision: 1,
        fullScript: "Synthetic script",
        keyPoints: [],
      },
    ],
    sessions: [],
    attempts: [],
    pdf: new Blob(["%PDF synthetic"]),
  };
}

beforeEach(async () => {
  await closeStorage();
  await deleteDB(DATABASE_NAME);
});
afterEach(async () => {
  await closeStorage();
  await deleteDB(DATABASE_NAME);
});

describe("transactional local storage", () => {
  it("persists PDF separately, preserves historical revision, and deletes related records", async () => {
    const item = fixture();
    await saveProject(item, item.pdf);
    const session = {
      id: crypto.randomUUID(),
      projectId: item.project.id,
      mode: "sequential" as const,
      startedAt: now,
      slideIds: [item.slides[0].id],
    };
    const attempt = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      slideId: item.slides[0].id,
      slideRevision: 1,
      startedAt: now,
      finishedAt: now,
      durationSeconds: 5,
      hintsUsed: [],
      rating: "good" as const,
    };
    await saveSession(session, [attempt]);
    await saveSlide({ ...item.slides[0], fullScript: "Revised", revision: 2 });
    await closeStorage();
    const reloaded = await loadProject(item.project.id);
    expect(reloaded.slides[0].revision).toBe(2);
    expect(reloaded.attempts[0].slideRevision).toBe(1);
    expect(await (await getPdf(item.project.pdfAssetId!))?.text()).toBe(
      "%PDF synthetic",
    );
    expect(await getPdf(item.project.pdfAssetId!)).toBe(
      await getPdf(item.project.pdfAssetId!),
    );
    await deleteProject(item.project.id);
    expect(await listProjects()).toEqual([]);
    expect(await getPdf(item.project.pdfAssetId!)).toBeUndefined();
    const db = await openDB(DATABASE_NAME);
    expect(await db.count("attempts")).toBe(0);
    expect(await db.count("sessions")).toBe(0);
    expect(await db.count("slides")).toBe(0);
    db.close();
  });
  it("restores copies with remapped references without overwriting originals", async () => {
    const item = fixture();
    await saveProject(item, item.pdf);
    const session = {
      id: crypto.randomUUID(),
      projectId: item.project.id,
      mode: "rehearsal" as const,
      startedAt: now,
      slideIds: [item.slides[0].id],
    };
    const attempt = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      slideId: item.slides[0].id,
      slideRevision: 1,
      startedAt: now,
      finishedAt: now,
      durationSeconds: 10,
      hintsUsed: [],
    };
    await saveSession(
      {
        ...session,
        progress: { index: 0, phase: "recall", attemptId: attempt.id },
      },
      [attempt],
    );
    const exported = await exportAll();
    await importCopies(exported);
    const projects = await listProjects();
    expect(projects).toHaveLength(2);
    const copy = await loadProject(
      projects.find((project) => project.id !== item.project.id)!.id,
    );
    expect(copy.slides[0].id).not.toBe(item.slides[0].id);
    expect(copy.slides[0].projectId).toBe(copy.project.id);
    expect(copy.sessions[0].slideIds).toEqual([copy.slides[0].id]);
    expect(copy.attempts[0].sessionId).toBe(copy.sessions[0].id);
    expect(copy.attempts[0].slideId).toBe(copy.slides[0].id);
    expect(copy.sessions[0].progress).toEqual({
      index: 0,
      phase: "recall",
      attemptId: copy.attempts[0].id,
    });
    expect(copy.attempts[0].id).not.toBe(attempt.id);
    expect(await (await getPdf(copy.project.pdfAssetId!))?.text()).toBe(
      "%PDF synthetic",
    );
  });
  it("migrates v1 by adding indexes without deleting existing data", async () => {
    const item = fixture();
    const old = await openDB(DATABASE_NAME, 1, {
      upgrade(db) {
        for (const name of [
          "projects",
          "slides",
          "pdfs",
          "sessions",
          "attempts",
        ])
          db.createObjectStore(name, { keyPath: "id" });
      },
    });
    await old.put("projects", item.project);
    await old.put("slides", item.slides[0]);
    old.close();
    const loaded = await loadProject(item.project.id);
    expect(loaded.project.title).toBe("Synthetic");
    expect(loaded.slides).toEqual(item.slides);
  });
});
