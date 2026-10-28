import type {
  PracticeAttempt,
  PracticeMode,
  Rating,
  Slide,
} from "../../domain/types";

export type ClockState = { elapsedMs: number; resumedAt: number | null };
export const MAX_ATTEMPTS_PER_SLIDE = 3;
export const elapsedSeconds = (clock: ClockState, now: number): number =>
  Math.max(
    0,
    (clock.elapsedMs + (clock.resumedAt === null ? 0 : now - clock.resumedAt)) /
      1000,
  );
export function pauseClock(clock: ClockState, now: number): ClockState {
  return { elapsedMs: elapsedSeconds(clock, now) * 1000, resumedAt: null };
}
export function resumeClock(clock: ClockState, now: number): ClockState {
  return clock.resumedAt === null ? { ...clock, resumedAt: now } : clock;
}
export function currentAttempts(
  slide: Slide,
  attempts: PracticeAttempt[],
): PracticeAttempt[] {
  return attempts
    .filter((a) => a.slideId === slide.id && a.slideRevision === slide.revision)
    .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
}
export function weakness(slide: Slide, attempts: PracticeAttempt[]): number {
  const history = currentAttempts(slide, attempts).filter((a) => a.rating);
  if (!history.length) return 0;
  const last = history[history.length - 1];
  const bad = history.filter((a) => a.rating === "again").length;
  const partial = history.filter((a) => a.rating === "partial").length;
  return (
    (last.rating === "again" ? 8 : last.rating === "partial" ? 4 : 0) +
    Math.max(0, ...last.hintsUsed.map((h) => h.level)) +
    (bad * 2 + partial) / history.length
  );
}
export function buildQueue(
  slides: Slide[],
  attempts: PracticeAttempt[],
  mode: PracticeMode,
  from: number,
  to: number,
  random = Math.random,
): string[] {
  let selected = slides
    .filter((s) => s.pageNumber >= from && s.pageNumber <= to)
    .sort((a, b) => a.pageNumber - b.pageNumber);
  if (mode === "weak")
    selected = selected
      .filter((s) => weakness(s, attempts) > 0)
      .sort(
        (a, b) =>
          weakness(b, attempts) - weakness(a, attempts) ||
          a.pageNumber - b.pageNumber,
      );
  const queue = selected.map((s) => s.id);
  if (mode === "random") {
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
  }
  return queue;
}
export function scheduleRetry(
  queue: string[],
  index: number,
  rating: Rating,
): string[] {
  const result = [...queue];
  const id = queue[index];
  if (
    !id ||
    rating === "good" ||
    queue.filter((item) => item === id).length >= MAX_ATTEMPTS_PER_SLIDE
  )
    return result;
  // Two other cards precede an "again" retry when enough cards remain.
  result.splice(
    rating === "again" ? Math.min(index + 3, result.length) : result.length,
    0,
    id,
  );
  return result;
}
export function revealHint(
  attempt: PracticeAttempt,
  seconds: number,
): PracticeAttempt {
  const level = Math.max(0, ...attempt.hintsUsed.map((h) => h.level)) + 1;
  if (level > 3) return attempt;
  return {
    ...attempt,
    hintsUsed: [
      ...attempt.hintsUsed,
      { level: level as 1 | 2 | 3, atSeconds: seconds },
    ],
  };
}
export function finishAttempt(
  attempt: PracticeAttempt,
  seconds: number,
  now: string,
): PracticeAttempt {
  // Answer checking does not call revealHint: only a hint shown during recall is recorded.
  return { ...attempt, durationSeconds: seconds, finishedAt: now };
}
export function formatDuration(seconds: number): string {
  const rounded = Math.floor(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}
