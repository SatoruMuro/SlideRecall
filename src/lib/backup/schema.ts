import { z } from "zod";
import type { ProjectData } from "../../domain/types";

const id = z.string().uuid();
const date = z.string().datetime({ offset: true });
const text = z.string().max(2_000_000);
const revision = z.number().int().min(1).max(1_000_000);
export const projectSchema = z
  .object({
    id,
    title: z.string().min(1).max(500),
    pdfAssetId: id.optional(),
    pageCount: z.number().int().min(1).max(1000),
    createdAt: date,
    updatedAt: date,
    schemaVersion: z.literal(1),
  })
  .strict();
export const slidesSchema = z
  .array(
    z
      .object({
        id,
        projectId: id,
        pageNumber: z.number().int().min(1).max(1000),
        fullScript: text,
        openingExact: text.optional(),
        keyPoints: z
          .array(z.object({ id, text, required: z.boolean() }).strict())
          .max(200),
        closingExact: text.optional(),
        transitionToNext: text.optional(),
        targetSeconds: z.number().positive().max(86400).optional(),
        revision,
      })
      .strict(),
  )
  .max(1000);
export const sessionsSchema = z
  .array(
    z
      .object({
        id,
        projectId: id,
        mode: z.enum(["sequential", "weak", "random", "rehearsal"]),
        startedAt: date,
        endedAt: date.optional(),
        slideIds: z.array(id).max(10000),
        progress: z
          .object({
            index: z.number().int().nonnegative().max(9999),
            phase: z.enum(["recall", "answer", "rating", "next"]),
            attemptId: id,
          })
          .strict()
          .optional(),
      })
      .strict(),
  )
  .max(20000);
export const attemptsSchema = z
  .array(
    z
      .object({
        id,
        sessionId: id,
        slideId: id,
        slideRevision: revision,
        startedAt: date,
        finishedAt: date,
        durationSeconds: z.number().nonnegative().max(31_536_000),
        hintsUsed: z
          .array(
            z
              .object({
                level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
                atSeconds: z.number().nonnegative().max(31_536_000),
              })
              .strict(),
          )
          .max(3),
        rating: z.enum(["good", "partial", "again"]).optional(),
      })
      .strict(),
  )
  .max(100000);
export const manifestSchema = z
  .object({
    formatVersion: z.literal(1),
    exportedAt: date,
    projects: z.array(id).max(100),
  })
  .strict();

const unique = (values: (string | number)[]) =>
  new Set(values).size === values.length;
export function validateReferences(data: ProjectData) {
  const { project, slides, sessions, attempts } = data;
  const slideMap = new Map(slides.map((slide) => [slide.id, slide]));
  const sessionMap = new Map(sessions.map((session) => [session.id, session]));
  const attemptMap = new Map(attempts.map((attempt) => [attempt.id, attempt]));
  if (
    slides.length !== project.pageCount ||
    !unique(slides.map((slide) => slide.id)) ||
    !unique(slides.map((slide) => slide.pageNumber)) ||
    !unique(sessions.map((session) => session.id)) ||
    !unique(attempts.map((attempt) => attempt.id)) ||
    slides.some(
      (slide) =>
        slide.projectId !== project.id ||
        slide.pageNumber > project.pageCount ||
        !unique(slide.keyPoints.map((point) => point.id)),
    ) ||
    sessions.some((session) => {
      const progress = session.progress;
      const attempt = progress ? attemptMap.get(progress.attemptId) : undefined;
      return (
        session.projectId !== project.id ||
        session.slideIds.some((slideId) => !slideMap.has(slideId)) ||
        (session.endedAt &&
          Date.parse(session.endedAt) < Date.parse(session.startedAt)) ||
        (progress &&
          (session.endedAt ||
            progress.index >= session.slideIds.length ||
            !attempt ||
            attempt.sessionId !== session.id ||
            attempt.slideId !== session.slideIds[progress.index]))
      );
    }) ||
    attempts.some((attempt) => {
      const slide = slideMap.get(attempt.slideId);
      const session = sessionMap.get(attempt.sessionId);
      return (
        !slide ||
        !session ||
        !session.slideIds.includes(attempt.slideId) ||
        attempt.slideRevision > slide.revision ||
        Date.parse(attempt.finishedAt) < Date.parse(attempt.startedAt) ||
        attempt.hintsUsed.some(
          (hint) => hint.atSeconds > attempt.durationSeconds + 1,
        ) ||
        !unique(attempt.hintsUsed.map((hint) => hint.level))
      );
    })
  )
    throw new Error("バックアップ内のスライドや練習履歴の対応が不正です。");
}
