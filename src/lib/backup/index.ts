import JSZip from "jszip";
import type { BackupProject } from "../../domain/types";
import {
  attemptsSchema,
  manifestSchema,
  projectSchema,
  sessionsSchema,
  slidesSchema,
  validateReferences,
} from "./schema";
import {
  inspectZip,
  MAX_BACKUP_BYTES,
  MAX_PDF_BYTES,
  readBounded,
} from "./zipSafety";

export { MAX_BACKUP_BYTES, MAX_PDF_BYTES } from "./zipSafety";

export async function exportBackup(items: BackupProject[]): Promise<Blob> {
  if (items.length > 100)
    throw new Error("一度のバックアップは100件までです。");
  try {
    const ids = items.map((item) => item.project.id);
    if (new Set(ids).size !== ids.length) throw new Error("duplicate project");
    for (const item of items) {
      projectSchema.parse(item.project);
      slidesSchema.parse(item.slides);
      sessionsSchema.parse(item.sessions);
      attemptsSchema.parse(item.attempts);
      validateReferences(item);
    }
  } catch {
    throw new Error(
      "保存データの形式または件数がバックアップの上限に合いません。原稿や練習履歴を確認してください。",
    );
  }
  const zip = new JSZip();
  let total = 0;
  const add = (name: string, value: string | Uint8Array) => {
    const size =
      typeof value === "string"
        ? new TextEncoder().encode(value).length
        : value.byteLength;
    if (name.endsWith(".json") && size > 16 * 1024 * 1024)
      throw new Error("一つのデータファイルが16 MBの上限を超えています。");
    total += size;
    if (total > MAX_BACKUP_BYTES)
      throw new Error("バックアップの上限は256 MBです。");
    zip.file(name, value, { createFolders: false });
  };
  add(
    "manifest.json",
    JSON.stringify({
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      projects: items.map((item) => item.project.id),
    }),
  );
  for (const item of items) {
    const root = `projects/${item.project.id}/`;
    add(`${root}project.json`, JSON.stringify(item.project));
    add(`${root}slides.json`, JSON.stringify(item.slides));
    add(`${root}sessions.json`, JSON.stringify(item.sessions));
    add(`${root}attempts.json`, JSON.stringify(item.attempts));
    if (item.project.pdfAssetId && !item.pdf)
      throw new Error(
        "PDFが見つからないため、完全なバックアップを作成できません。",
      );
    if (item.pdf) {
      if (item.pdf.size > MAX_PDF_BYTES)
        throw new Error("PDFの上限は100 MBです。");
      add(
        `${root}presentation.pdf`,
        new Uint8Array(await item.pdf.arrayBuffer()),
      );
    }
  }
  // STORE avoids pathological compression ratios and supports predictable import limits.
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "STORE",
  });
  if (bytes.length > MAX_BACKUP_BYTES)
    throw new Error("バックアップの上限は256 MBです。");
  return new Blob([bytes as Uint8Array<ArrayBuffer>], {
    type: "application/zip",
  });
}

export async function importBackup(blob: Blob): Promise<BackupProject[]> {
  try {
    if (blob.size > MAX_BACKUP_BYTES) throw new Error("size");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const entries = inspectZip(bytes);
    const zip = await JSZip.loadAsync(bytes, { createFolders: false });
    const used = new Set<string>();
    const read = async (name: string) => {
      const file = zip.file(name);
      const entry = entries.get(name);
      if (!file || !entry) throw new Error("missing file");
      used.add(name);
      return readBounded(file, entry);
    };
    const readJson = async (name: string): Promise<unknown> =>
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(await read(name)),
      ) as unknown;
    const manifest = manifestSchema.parse(await readJson("manifest.json"));
    if (new Set(manifest.projects).size !== manifest.projects.length)
      throw new Error("duplicate project");
    const result: BackupProject[] = [];
    for (const projectId of manifest.projects) {
      const root = `projects/${projectId}/`;
      const project = projectSchema.parse(
        await readJson(`${root}project.json`),
      );
      if (project.id !== projectId) throw new Error("project mismatch");
      const slides = slidesSchema.parse(await readJson(`${root}slides.json`));
      const sessions = sessionsSchema.parse(
        await readJson(`${root}sessions.json`),
      );
      const attempts = attemptsSchema.parse(
        await readJson(`${root}attempts.json`),
      );
      const data: BackupProject = { project, slides, sessions, attempts };
      validateReferences(data);
      if (project.pdfAssetId) {
        const pdf = await read(`${root}presentation.pdf`);
        if (new TextDecoder().decode(pdf.subarray(0, 5)) !== "%PDF-")
          throw new Error("invalid PDF");
        data.pdf = new Blob([pdf as Uint8Array<ArrayBuffer>], {
          type: "application/pdf",
        });
      }
      result.push(data);
    }
    if (used.size !== entries.size) throw new Error("unexpected files");
    return result;
  } catch {
    // Do not show parser exceptions: they may include private document text.
    throw new Error(
      "バックアップを読み込めません。SlideRecall v1形式の正常なZIP（256 MB以内）を選んでください。",
    );
  }
}
