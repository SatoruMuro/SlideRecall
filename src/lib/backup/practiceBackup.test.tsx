import { Blob as NodeBlob } from "node:buffer";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PracticeAttempt,
  PracticeSession,
  ProjectData,
} from "../../domain/types";
import { Practice } from "../../features/practice/Practice";
import { saveSession } from "../storage";
import { exportBackup, importBackup } from "./index";

vi.mock("../storage", () => ({ saveSession: vi.fn(() => Promise.resolve()) }));
vi.mock("../../components/PdfSlide", () => ({
  PdfSlide: () => <div>合成PDF</div>,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("practice and backup contract", () => {
  it("backs up a completed retry session alongside an unfinished weak session", async () => {
    vi.stubGlobal("Blob", NodeBlob);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const projectId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const data: ProjectData = {
      project: {
        id: projectId,
        title: "合成発表",
        pageCount: 3,
        schemaVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      slides: [1, 2, 3].map((pageNumber) => ({
        id: crypto.randomUUID(),
        projectId,
        pageNumber,
        fullScript: `合成原稿${pageNumber}`,
        keyPoints: [],
        revision: 1,
      })),
      sessions: [],
      attempts: [],
    };
    const sessions = new Map<string, PracticeSession>();
    const attempts = new Map<string, PracticeAttempt>();
    vi.mocked(saveSession).mockImplementation(async (session, values) => {
      sessions.set(session.id, session);
      values.forEach((attempt) => attempts.set(attempt.id, attempt));
    });
    const first = render(<Practice data={data} onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "練習を開始" }));
    await screen.findByTestId("practice-slide-number");
    for (const [index, rating] of [
      "◎ スムーズ",
      "△ あいまい",
      "◎ スムーズ",
      "△ あいまい",
      "△ あいまい",
    ].entries()) {
      if (index === 1)
        fireEvent.click(screen.getByRole("button", { name: "ヒントを表示" }));
      fireEvent.click(
        screen.getByRole("button", { name: "発話を終えて答え合わせ" }),
      );
      fireEvent.click(
        await screen.findByRole("button", { name: "自己評価へ" }),
      );
      fireEvent.click(screen.getByRole("button", { name: rating }));
      fireEvent.click(
        await screen.findByRole("button", {
          name: index === 4 ? "結果を見る" : "次へ",
        }),
      );
      if (index !== 4)
        await screen.findByRole("button", { name: "発話を終えて答え合わせ" });
    }
    await screen.findByRole("heading", { name: "練習おつかれさまでした" });
    first.unmount();
    const prior = {
      ...data,
      sessions: [...sessions.values()],
      attempts: [...attempts.values()],
    };
    const exit = vi.fn();
    render(<Practice data={prior} initialMode="weak" onExit={exit} />);
    fireEvent.click(screen.getByRole("button", { name: "練習を開始" }));
    await screen.findByTestId("practice-slide-number");
    expect(screen.getByTestId("practice-slide-number")).toHaveTextContent(
      "スライド 2",
    );
    fireEvent.click(screen.getByRole("button", { name: "保存して終了" }));
    await waitFor(() => expect(exit).toHaveBeenCalledOnce());
    const snapshot = {
      ...data,
      sessions: [...sessions.values()],
      attempts: [...attempts.values()],
    };
    const [restored] = await importBackup(await exportBackup([snapshot]));
    expect(restored.sessions).toHaveLength(2);
    expect(
      restored.sessions.filter((session) => !!session.endedAt),
    ).toHaveLength(1);
    expect(restored.attempts.filter((attempt) => attempt.rating)).toHaveLength(
      5,
    );
    expect(
      restored.sessions.find((session) => !session.endedAt)?.progress?.index,
    ).toBe(0);
  });
});
