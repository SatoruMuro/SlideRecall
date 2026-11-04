import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PracticeMode, ProjectData } from "../../domain/types";
import { Practice } from "./Practice";
import { saveSession } from "../../lib/storage";

vi.mock("../../lib/storage", () => ({
  saveSession: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../components/PdfSlide", () => ({
  PdfSlide: ({ pageNumber }: { pageNumber: number }) => (
    <div>PDF page {pageNumber}</div>
  ),
}));
const data: ProjectData = {
  project: {
    id: "p",
    title: "Synthetic presentation",
    pageCount: 2,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    schemaVersion: 1,
  },
  slides: [1, 2].map((n) => ({
    id: `s${n}`,
    projectId: "p",
    pageNumber: n,
    fullScript: `Private synthetic script ${n}`,
    openingExact: "Opening phrase",
    keyPoints: [{ id: `k${n}`, text: "Key idea", required: true }],
    revision: 1,
  })),
  attempts: [],
  sessions: [],
};
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("practice screen", () => {
  it.each<PracticeMode>(["sequential", "weak", "random", "rehearsal"])(
    "keeps the PDF mounted through hint and fullscreen changes in %s mode",
    async (mode) => {
      const script = "本日はありがとうございます。次に研究を紹介します。";
      const practiceData: ProjectData = {
        ...data,
        slides: data.slides.map((slide) => ({ ...slide, fullScript: script })),
        attempts: [{
          id: "previous-attempt",
          sessionId: "previous-session",
          slideId: "s1",
          slideRevision: 1,
          startedAt: "2026-01-01T00:00:00Z",
          finishedAt: "2026-01-01T00:00:10Z",
          durationSeconds: 10,
          hintsUsed: [],
          rating: "again",
        }],
      };
      render(<Practice data={practiceData} initialMode={mode} onExit={() => undefined} />);
      fireEvent.change(screen.getByLabelText("終了スライド"), { target: { value: "1" } });
      fireEvent.click(screen.getByRole("button", { name: "練習を開始" }));
      await screen.findByTestId("practice-slide-number");
      const pdf = screen.getByText("PDF page 1");
      expect(screen.queryByText(script)).toBeNull();
      if (mode === "rehearsal") {
        expect(screen.queryByRole("button", { name: "ヒントを表示" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "ヒント操作を有効にする" }));
      }
      for (const [index, expected] of ["本日は……", "本日はありがとう……", script].entries()) {
        fireEvent.click(screen.getByRole("button", { name: "ヒントを表示" }));
        expect(screen.getByText(expected)).toBeVisible();
        expect(screen.getByText("PDF page 1")).toBe(pdf);
        await waitFor(() => expect(vi.mocked(saveSession).mock.calls.at(-1)?.[1].at(-1)?.hintsUsed.map((hint) => hint.level)).toEqual([1, 2, 3].slice(0, index + 1)));
      }
      fireEvent.click(screen.getByRole("button", { name: "全画面" }));
      expect(pdf.closest(".practice-stage")).toHaveClass("practice-fullscreen");
      expect(screen.getByText("PDF page 1")).toBe(pdf);
      fireEvent.click(screen.getByRole("button", { name: "全画面を終了" }));
      expect(pdf.closest(".practice-stage")).not.toHaveClass("practice-fullscreen");
      expect(screen.getByText("PDF page 1")).toBe(pdf);
      if (mode !== "rehearsal") {
        fireEvent.click(screen.getByRole("button", { name: "発話を終えて答え合わせ" }));
        await screen.findByRole("button", { name: "自己評価へ" });
        expect(screen.getByText("PDF page 1")).toBe(pdf);
        fireEvent.click(screen.getByRole("button", { name: "自己評価へ" }));
        fireEvent.click(screen.getByRole("button", { name: "◎ スムーズ" }));
        await screen.findByRole("button", { name: "結果を見る" });
        expect(screen.getByText("PDF page 1")).toBe(pdf);
      }
      expect(vi.mocked(saveSession).mock.calls.at(-1)?.[1].at(-1)?.hintsUsed.map((hint) => hint.level)).toEqual([1, 2, 3]);
    },
  );
  it("hides the script during recall and persists answer checking without a hint", async () => {
    render(<Practice data={data} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "練習を開始" }));
    await screen.findByTestId("practice-slide-number");
    expect(screen.queryByText("Private synthetic script 1")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "発話を終えて答え合わせ" }),
    );
    await screen.findByText("Private synthetic script 1");
    expect(vi.mocked(saveSession).mock.calls.at(-1)?.[1][0].hintsUsed).toEqual(
      [],
    );
    fireEvent.click(screen.getByRole("button", { name: "自己評価へ" }));
    fireEvent.click(screen.getByRole("button", { name: /◎ スムーズ/ }));
    await screen.findByRole("button", { name: "次へ" });
    expect(vi.mocked(saveSession).mock.calls.at(-1)?.[1][0].rating).toBe(
      "good",
    );
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    await waitFor(() =>
      expect(screen.getByTestId("practice-slide-number")).toHaveTextContent(
        "スライド 2",
      ),
    );
    expect(screen.queryByText("Private synthetic script 2")).toBeNull();
  });
  it("moves to the next or previous slide without a confirmation dialog while saving ungraded attempts", async () => {
    const confirmation = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Practice data={data} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "練習を開始" }));
    await screen.findByTestId("practice-slide-number");

    fireEvent.click(screen.getByRole("button", { name: "未評価で次へ" }));
    await waitFor(() =>
      expect(screen.getByTestId("practice-slide-number")).toHaveTextContent("スライド 2"),
    );
    expect(confirmation).not.toHaveBeenCalled();
    const [, skippedAttempts] = vi.mocked(saveSession).mock.calls.at(-1)!;
    expect(skippedAttempts.find((attempt) => attempt.slideId === "s1")?.rating).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "前のスライドを練習" }));
    await waitFor(() =>
      expect(screen.getByTestId("practice-slide-number")).toHaveTextContent("スライド 1"),
    );
    expect(confirmation).not.toHaveBeenCalled();
    expect(vi.mocked(saveSession).mock.calls.at(-1)?.[1].some(
      (attempt) => attempt.slideId === "s2" && attempt.rating === undefined,
    )).toBe(true);
  });

  it("does not navigate away when saving an ungraded attempt fails", async () => {
    render(<Practice data={data} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "練習を開始" }));
    await screen.findByTestId("practice-slide-number");
    vi.mocked(saveSession).mockRejectedValueOnce(new Error("synthetic storage error"));
    fireEvent.click(screen.getByRole("button", { name: "未評価で次へ" }));
    await screen.findByRole("alert");
    expect(screen.getByTestId("practice-slide-number")).toHaveTextContent("スライド 1");
  });

  it("uses Space/H to reveal hints and P to pause without changing the script", async () => {
    render(<Practice data={data} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "練習を開始" }));
    await screen.findByTestId("practice-slide-number");
    const original = data.slides[0].fullScript;
    fireEvent.keyDown(document.body, { key: " ", code: "Space" });
    expect(screen.getByText("Pri……")).toBeVisible();
    await waitFor(() =>
      expect(vi.mocked(saveSession).mock.calls.at(-1)?.[1][0].hintsUsed).toHaveLength(1),
    );
    fireEvent.keyDown(document.body, { key: "h", code: "KeyH" });
    expect(screen.getByText("文頭8文字を表示中")).toBeVisible();
    fireEvent.keyDown(document.body, { key: "p", code: "KeyP" });
    expect(screen.getByText(/一時停止中/)).toBeVisible();
    fireEvent.keyDown(document.body, { key: "p", code: "KeyP" });
    expect(screen.queryByText(/一時停止中/)).toBeNull();
    expect(data.slides[0].fullScript).toBe(original);
  });

  it("moves to the next or previous slide by arrow keys with ungraded saved attempts", async () => {
    const confirmation = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Practice data={data} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "練習を開始" }));
    await screen.findByTestId("practice-slide-number");
    fireEvent.keyDown(document.body, { key: "ArrowRight", code: "ArrowRight" });
    await waitFor(() =>
      expect(screen.getByTestId("practice-slide-number")).toHaveTextContent("スライド 2"),
    );
    expect(confirmation).not.toHaveBeenCalled();
    const [, attempts] = vi.mocked(saveSession).mock.calls.at(-1)!;
    expect(attempts.find((a) => a.slideId === "s1")?.rating).toBeUndefined();

    fireEvent.keyDown(document.body, { key: "ArrowLeft", code: "ArrowLeft" });
    await waitFor(() =>
      expect(screen.getByTestId("practice-slide-number")).toHaveTextContent("スライド 1"),
    );
    expect(confirmation).not.toHaveBeenCalled();
  });

  it("uses Space for hints even when a navigation button is focused, without auto-repeat", async () => {
    render(<Practice data={data} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "練習を開始" }));
    await screen.findByTestId("practice-slide-number");
    const nextButton = screen.getByRole("button", { name: "未評価で次へ" });
    fireEvent.keyDown(nextButton, { key: " ", code: "Space", repeat: true });
    expect(screen.queryByText("Pri……")).toBeNull();
    fireEvent.keyDown(nextButton, { key: " ", code: "Space" });
    expect(screen.getByText("Pri……")).toBeVisible();
    expect(screen.getByTestId("practice-slide-number")).toHaveTextContent("スライド 1");
  });

  it("allows Space to intentionally reveal a hint in rehearsal mode", async () => {
    render(<Practice data={data} onExit={() => undefined} initialMode="rehearsal" />);
    fireEvent.click(screen.getByRole("button", { name: "練習を開始" }));
    await screen.findByTestId("practice-slide-number");
    expect(screen.queryByRole("button", { name: "ヒントを表示" })).toBeNull();
    fireEvent.keyDown(document.body, { key: " ", code: "Space" });
    expect(screen.getByText("Pri……")).toBeVisible();
    expect(screen.getByRole("button", { name: "ヒントを表示" })).toBeVisible();
  });

  it("records hints only while recalling and includes the frozen script revision", async () => {
    render(<Practice data={data} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "練習を開始" }));
    await screen.findByTestId("practice-slide-number");
    fireEvent.click(screen.getByRole("button", { name: "ヒントを表示" }));
    expect(screen.getByText("Pri……")).toBeVisible();
    expect(screen.queryByText("Private synthetic script 1")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "発話を終えて答え合わせ" }),
    );
    await screen.findByRole("button", { name: "自己評価へ" });
    const attempt = vi.mocked(saveSession).mock.calls.at(-1)?.[1][0];
    expect(attempt?.hintsUsed).toHaveLength(1);
    expect(attempt?.hintsUsed[0].level).toBe(1);
    expect(attempt?.slideRevision).toBe(1);
  });
  it("derives sentence-start hints and anchors from an unedited imported script", async () => {
    const unedited: ProjectData = {
      ...data,
      slides: data.slides.map((slide, index) =>
        index === 0
          ? {
              ...slide,
              fullScript: "本日はありがとうございます。次に研究を紹介します。",
              openingExact: undefined,
              closingExact: undefined,
              keyPoints: [],
            }
          : slide,
      ),
    };
    render(<Practice data={unedited} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "練習を開始" }));
    await screen.findByTestId("practice-slide-number");
    fireEvent.click(screen.getByRole("button", { name: "ヒントを表示" }));
    expect(screen.getByText("本日は……")).toBeVisible();
    expect(screen.getByText("次に研……")).toBeVisible();
    expect(screen.queryByText("本日はありがとうございます。次に研究を紹介します。")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ヒントを表示" }));
    expect(screen.getByText("本日はありがとう……")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "ヒントを表示" }));
    expect(screen.getByText("本日はありがとうございます。次に研究を紹介します。")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "発話を終えて答え合わせ" }));
    await screen.findByText("本日はありがとうございます。");
    expect(screen.getByText("次に研究を紹介します。")).toBeVisible();
    expect(vi.mocked(saveSession).mock.calls.at(-1)?.[1][0].hintsUsed).toHaveLength(3);
  });
  it("does not advance when a database transaction fails", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
    render(<Practice data={data} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "練習を開始" }));
    await screen.findByTestId("practice-slide-number");
    vi.mocked(saveSession).mockRejectedValueOnce(
      new Error("synthetic storage full"),
    );
    clock.mockReturnValue(6000);
    fireEvent.click(
      screen.getByRole("button", { name: "発話を終えて答え合わせ" }),
    );
    await screen.findByRole("alert");
    expect(
      screen.getByRole("button", { name: "発話を終えて答え合わせ" }),
    ).toBeEnabled();
    expect(screen.queryByText("Private synthetic script 1")).toBeNull();
    clock.mockReturnValue(16000);
    fireEvent.click(
      screen.getByRole("button", { name: "発話を終えて答え合わせ" }),
    );
    await screen.findByRole("button", { name: "自己評価へ" });
    expect(
      vi.mocked(saveSession).mock.calls.at(-1)?.[1][0].durationSeconds,
    ).toBe(5);
  });
  it("rehearses consecutive slides without revealing scripts and defers ratings", async () => {
    render(
      <Practice data={data} onExit={() => undefined} initialMode="rehearsal" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "練習を開始" }));
    await screen.findByTestId("practice-slide-number");
    expect(screen.queryByRole("button", { name: "ヒントを表示" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "次のスライドへ" }));
    await waitFor(() =>
      expect(screen.getByTestId("practice-slide-number")).toHaveTextContent(
        "スライド 2",
      ),
    );
    expect(screen.queryByText("Private synthetic script 2")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "リハーサルを終了" }));
    await screen.findByRole("heading", { name: "練習おつかれさまでした" });
    const [session, attempts] = vi.mocked(saveSession).mock.calls.at(-1)!;
    expect(session.endedAt).toBeTruthy();
    expect(attempts).toHaveLength(2);
    expect(attempts.every((a) => !a.rating && a.hintsUsed.length === 0)).toBe(
      true,
    );
  });
  it("resumes the second rehearsal card, preserving the intentionally ungraded first card", async () => {
    const first = render(
      <Practice data={data} onExit={() => undefined} initialMode="rehearsal" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "練習を開始" }));
    await screen.findByTestId("practice-slide-number");
    fireEvent.click(screen.getByRole("button", { name: "次のスライドへ" }));
    await waitFor(() =>
      expect(screen.getByTestId("practice-slide-number")).toHaveTextContent(
        "スライド 2",
      ),
    );
    const [session, attempts] = vi.mocked(saveSession).mock.calls.at(-1)!;
    expect(session.progress?.index).toBe(1);
    expect(attempts).toHaveLength(2);
    first.unmount();
    render(
      <Practice
        data={{ ...data, sessions: [session], attempts }}
        onExit={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "続きから再開" }));
    await waitFor(() =>
      expect(screen.getByTestId("practice-slide-number")).toHaveTextContent(
        "スライド 2",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "リハーサルを終了" }));
    await screen.findByRole("heading", { name: "練習おつかれさまでした" });
    expect(vi.mocked(saveSession).mock.calls.at(-1)?.[1]).toHaveLength(2);
  });
  it("keeps old-revision snapshots separate when resuming an edited slide", async () => {
    const first = render(<Practice data={data} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "練習を開始" }));
    await screen.findByTestId("practice-slide-number");
    const [session, attempts] = vi.mocked(saveSession).mock.calls.at(-1)!;
    first.unmount();
    render(
      <Practice
        data={{
          ...data,
          slides: data.slides.map((s) =>
            s.id === "s1" ? { ...s, revision: 2 } : s,
          ),
          sessions: [session],
          attempts,
        }}
        onExit={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "続きから再開" }));
    await screen.findByTestId("practice-slide-number");
    const saved = vi.mocked(saveSession).mock.calls.at(-1)![1];
    expect(saved.map((a) => a.slideRevision)).toEqual([1, 2]);
    expect(saved[0].id).not.toBe(saved[1].id);
  });
});
