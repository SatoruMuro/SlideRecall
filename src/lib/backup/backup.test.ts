// @vitest-environment node
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import type { BackupProject } from "../../domain/types";
import { exportBackup, importBackup } from "./index";
import { inspectZip } from "./zipSafety";

function sample(): BackupProject {
  const projectId = crypto.randomUUID();
  const slideId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const time = "2026-10-28T00:00:00.000Z";
  return {
    project: {
      id: projectId,
      title: "合成テスト",
      pageCount: 1,
      pdfAssetId: crypto.randomUUID(),
      schemaVersion: 1,
      createdAt: time,
      updatedAt: time,
    },
    slides: [
      {
        id: slideId,
        projectId,
        pageNumber: 1,
        fullScript: "<script>synthetic only</script>\n行2",
        keyPoints: [],
        revision: 2,
      },
    ],
    sessions: [
      {
        id: sessionId,
        projectId,
        startedAt: time,
        endedAt: time,
        mode: "sequential",
        slideIds: [slideId],
      },
    ],
    attempts: [
      {
        id: crypto.randomUUID(),
        sessionId,
        slideId,
        slideRevision: 1,
        startedAt: time,
        finishedAt: time,
        durationSeconds: 12,
        hintsUsed: [{ level: 1, atSeconds: 3 }],
        rating: "partial",
      },
    ],
    pdf: new Blob(["%PDF-1.4\n% synthetic unit fixture only\n%%EOF"], {
      type: "application/pdf",
    }),
  };
}

async function mutateBackup(item: BackupProject, mutate: (zip: JSZip) => void) {
  const exported = await exportBackup([item]);
  const zip = await JSZip.loadAsync(await exported.arrayBuffer());
  mutate(zip);
  return new Blob([
    (await zip.generateAsync({
      type: "uint8array",
    })) as Uint8Array<ArrayBuffer>,
  ]);
}

describe("bounded private ZIP backups", () => {
  it("round trips scripts, revisions, hints, history and binary PDF", async () => {
    const item = sample();
    const [restored] = await importBackup(await exportBackup([item]));
    expect(restored.project).toEqual(item.project);
    expect(restored.slides).toEqual(item.slides);
    expect(restored.sessions).toEqual(item.sessions);
    expect(restored.attempts).toEqual(item.attempts);
    expect(await restored.pdf?.text()).toBe(await item.pdf?.text());
  });
  it("round trips an empty database", async () => {
    expect(await importBackup(await exportBackup([]))).toEqual([]);
  });
  it("round trips in-progress sessions and rejects a mismatched resume cursor", async () => {
    const item = sample();
    delete item.sessions[0].endedAt;
    item.sessions[0].progress = {
      index: 0,
      phase: "answer",
      attemptId: item.attempts[0].id,
    };
    const [restored] = await importBackup(await exportBackup([item]));
    expect(restored.sessions[0].progress).toEqual(item.sessions[0].progress);
    const invalid = await mutateBackup(item, (zip) =>
      zip.file(
        `projects/${item.project.id}/sessions.json`,
        JSON.stringify([
          {
            ...item.sessions[0],
            progress: { ...item.sessions[0].progress, index: 1 },
          },
        ]),
      ),
    );
    await expect(importBackup(invalid)).rejects.toThrow();
  });
  it("rejects corruption and unsupported format versions without echoing contents", async () => {
    await expect(
      importBackup(new Blob(["SECRET_SYNTHETIC_INVALID"])),
    ).rejects.toThrow("バックアップを読み込めません");
    const item = sample();
    const bad = await mutateBackup(item, (zip) =>
      zip.file(
        "manifest.json",
        JSON.stringify({
          formatVersion: 999,
          exportedAt: new Date().toISOString(),
          projects: [item.project.id],
        }),
      ),
    );
    await expect(importBackup(bad)).rejects.toThrow(
      "バックアップを読み込めません",
    );
  });
  it("rejects path traversal and unrecognized files", async () => {
    const item = sample();
    const bad = await mutateBackup(item, (zip) =>
      zip.file("../escape.json", "{}", { createFolders: false }),
    );
    await expect(importBackup(bad)).rejects.toThrow();
    const other = await mutateBackup(item, (zip) =>
      zip.file("remote-url.txt", "https://example.invalid", {
        createFolders: false,
      }),
    );
    await expect(importBackup(other)).rejects.toThrow();
  });
  it("rejects reference corruption and unexpected schema fields", async () => {
    const item = sample();
    const bad = await mutateBackup(item, (zip) =>
      zip.file(
        `projects/${item.project.id}/attempts.json`,
        JSON.stringify([{ ...item.attempts[0], slideId: crypto.randomUUID() }]),
      ),
    );
    await expect(importBackup(bad)).rejects.toThrow();
    const badProject = await mutateBackup(item, (zip) =>
      zip.file(
        `projects/${item.project.id}/project.json`,
        JSON.stringify({
          ...item.project,
          remotePdfUrl: "https://example.invalid/data",
        }),
      ),
    );
    await expect(importBackup(badProject)).rejects.toThrow();
  });
  it("checks inflated size limits before allocating and detects CRC corruption", async () => {
    const blob = await exportBackup([sample()]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    let central = 0;
    while (
      central < bytes.length - 4 &&
      view.getUint32(central, true) !== 0x02014b50
    )
      central++;
    view.setUint32(central + 24, 0x7fffffff, true);
    expect(() => inspectZip(bytes)).toThrow();
    const damaged = new Uint8Array(await blob.arrayBuffer());
    const data = new DataView(damaged.buffer);
    const payloadOffset =
      30 + data.getUint16(26, true) + data.getUint16(28, true);
    damaged[payloadOffset] ^= 1;
    await expect(importBackup(new Blob([damaged]))).rejects.toThrow();
  });
  it("rejects missing PDFs instead of producing an incomplete backup", async () => {
    const item = sample();
    delete item.pdf;
    await expect(exportBackup([item])).rejects.toThrow("PDFが見つからない");
  });
  it("bounds actual inflation when a forged header understates the expanded size", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", "A".repeat(100000));
    const bytes = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
    });
    const view = new DataView(bytes.buffer);
    view.setUint32(22, 100, true);
    let central = 0;
    while (
      central < bytes.length - 4 &&
      view.getUint32(central, true) !== 0x02014b50
    )
      central++;
    view.setUint32(central + 24, 100, true);
    expect(inspectZip(bytes).get("manifest.json")?.size).toBe(100);
    await expect(
      importBackup(new Blob([bytes as Uint8Array<ArrayBuffer>])),
    ).rejects.toThrow();
  });
});
