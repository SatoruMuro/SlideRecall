export type Rating = "good" | "partial" | "again";
export type PracticeMode = "sequential" | "weak" | "random" | "rehearsal";
export type Project = {
  id: string;
  title: string;
  pdfAssetId?: string;
  pageCount: number;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
};
export type Slide = {
  id: string;
  projectId: string;
  pageNumber: number;
  fullScript: string;
  openingExact?: string;
  keyPoints: { id: string; text: string; required: boolean }[];
  closingExact?: string;
  transitionToNext?: string;
  targetSeconds?: number;
  revision: number;
};
export type PracticeSession = {
  id: string;
  projectId: string;
  mode: PracticeMode;
  startedAt: string;
  endedAt?: string;
  slideIds: string[];
  progress?: {
    index: number;
    phase: "recall" | "answer" | "rating" | "next";
    attemptId: string;
  };
};
export type PracticeAttempt = {
  id: string;
  sessionId: string;
  slideId: string;
  slideRevision: number;
  startedAt: string;
  finishedAt: string;
  durationSeconds: number;
  hintsUsed: { level: 1 | 2 | 3; atSeconds: number }[];
  rating?: Rating;
};
export type ProjectData = {
  project: Project;
  slides: Slide[];
  sessions: PracticeSession[];
  attempts: PracticeAttempt[];
};
export type BackupProject = ProjectData & { pdf?: Blob };
export const ratingLabels: Record<Rating, string> = {
  good: "◎ スムーズ",
  partial: "△ あいまい",
  again: "× 再現困難",
};
export const modeLabels: Record<PracticeMode, string> = {
  sequential: "順番練習",
  weak: "苦手集中",
  random: "ランダム練習",
  rehearsal: "本番リハーサル",
};
