import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectData } from "../../domain/types";
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
  it("records hints only while recalling and includes the frozen script revision", async () => {
    render(<Practice data={data} onExit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "練習を開始" }));
    await screen.findByTestId("practice-slide-number");
    fireEvent.click(screen.getByRole("button", { name: "ヒントを表示" }));
    expect(screen.getByText("Key idea（必須）")).toBeVisible();
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
