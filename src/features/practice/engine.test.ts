import { describe, expect, it } from "vitest";
import type { PracticeAttempt, Slide } from "../../domain/types";
import {
  buildQueue,
  currentAttempts,
  elapsedSeconds,
  finishAttempt,
  pauseClock,
  resumeClock,
  revealHint,
  scheduleRetry,
  weakness,
} from "./engine";

const slide = (n: number): Slide => ({
  id: `s${n}`,
  projectId: "p",
  pageNumber: n,
  fullScript: "",
  keyPoints: [],
  revision: 1,
});
const attempt: PracticeAttempt = {
  id: "a",
  sessionId: "session",
  slideId: "s1",
  slideRevision: 1,
  startedAt: "2026-01-01T00:00:00Z",
  finishedAt: "2026-01-01T00:00:10Z",
  durationSeconds: 10,
  hintsUsed: [],
  rating: "again",
};
describe("practice queue", () => {
  it("uses one-based ranges and shuffles without duplicates", () => {
    const slides = [slide(1), slide(2), slide(3), slide(4)];
    expect(buildQueue(slides, [], "sequential", 2, 4)).toEqual([
      "s2",
      "s3",
      "s4",
    ]);
    expect(buildQueue(slides, [], "random", 2, 4, () => 0).sort()).toEqual([
      "s2",
      "s3",
      "s4",
    ]);
  });
  it("puts again after two cards, partial at the end and good leaves queue unchanged", () => {
    const queue = ["s1", "s2", "s3", "s4"];
    expect(scheduleRetry(queue, 0, "again")).toEqual([
      "s1",
      "s2",
      "s3",
      "s1",
      "s4",
    ]);
    expect(scheduleRetry(queue, 0, "partial")).toEqual([...queue, "s1"]);
    expect(scheduleRetry(queue, 0, "good")).toEqual(queue);
  });
  it("terminates even when every rating is again", () => {
    let queue = ["s1", "s2", "s3"];
    for (let i = 0; i < queue.length; i++)
      queue = scheduleRetry(queue, i, "again");
    expect(queue).toHaveLength(9);
    for (const id of ["s1", "s2", "s3"])
      expect(queue.filter((x) => x === id)).toHaveLength(3);
  });
  it("ranks current-revision difficulty and excludes obsolete-revision ratings", () => {
    const slides = [slide(1), slide(2)];
    expect(buildQueue(slides, [attempt], "weak", 1, 2)).toEqual(["s1"]);
    const revised = { ...slides[0], revision: 2 };
    expect(weakness(revised, [attempt])).toBe(0);
    expect(currentAttempts(revised, [attempt])).toEqual([]);
    expect(buildQueue([revised, slides[1]], [attempt], "weak", 1, 2)).toEqual(
      [],
    );
  });
});
describe("hint, answer and timing", () => {
  it("records only recall hints, including their level and time", () => {
    const hinted = revealHint(attempt, 2.5);
    expect(hinted.hintsUsed).toEqual([{ level: 1, atSeconds: 2.5 }]);
    const answered = finishAttempt(hinted, 7, "2026-01-01T00:00:07Z");
    expect(answered.hintsUsed).toEqual(hinted.hintsUsed);
    expect(finishAttempt(attempt, 6, "2026-01-01T00:00:06Z").hintsUsed).toEqual(
      [],
    );
    expect(
      revealHint(revealHint(revealHint(hinted, 3), 4), 5).hintsUsed,
    ).toHaveLength(3);
  });
  it("excludes paused wall time and does not double resume", () => {
    const paused = pauseClock({ elapsedMs: 0, resumedAt: 1000 }, 3000);
    expect(elapsedSeconds(paused, 9000)).toBe(2);
    const resumed = resumeClock(paused, 10000);
    expect(elapsedSeconds(resumeClock(resumed, 11000), 12000)).toBe(4);
  });
});
