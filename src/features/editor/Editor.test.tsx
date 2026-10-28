import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectData, Slide } from "../../domain/types";
import { Editor } from "./Editor";

const { save } = vi.hoisted(() => ({
  save: vi.fn<(slide: Slide) => Promise<void>>(),
}));
vi.mock("../../lib/storage", () => ({ saveSlide: save }));
vi.mock("../../components/PdfSlide", () => ({
  PdfSlide: () => <div>合成PDF表示</div>,
}));

function fixture(): ProjectData {
  const projectId = crypto.randomUUID();
  const time = new Date().toISOString();
  return {
    project: {
      id: projectId,
      title: "合成発表",
      pageCount: 2,
      schemaVersion: 1,
      createdAt: time,
      updatedAt: time,
    },
    slides: [1, 2].map((pageNumber) => ({
      id: crypto.randomUUID(),
      projectId,
      pageNumber,
      fullScript: `原稿${pageNumber}`,
      keyPoints: [],
      revision: 1,
    })),
    sessions: [],
    attempts: [],
  };
}

beforeEach(() => {
  save.mockReset();
  save.mockResolvedValue();
});
afterEach(cleanup);

describe("editor durable autosave", () => {
  it("serializes writes and coalesces waiting edits without losing the newest revision", async () => {
    let completeFirst: (() => void) | undefined;
    save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          completeFirst = resolve;
        }),
    );
    const data = fixture();
    const exit = vi.fn();
    render(<Editor data={data} onExit={exit} />);
    const script = screen.getByLabelText("原稿全文");
    fireEvent.change(script, { target: { value: "First" } });
    fireEvent.change(script, { target: { value: "Second" } });
    fireEvent.change(script, { target: { value: "Final" } });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({
      fullScript: "First",
      revision: 2,
    });
    expect(screen.getByRole("button", { name: "編集を終える" })).toBeDisabled();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await act(async () => {
      completeFirst?.();
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("保存済み"),
    );
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toMatchObject({
      fullScript: "Final",
      revision: 4,
    });
    expect(data.slides[0].fullScript).toBe("原稿1");
    expect(data.slides[0].revision).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "編集を終える" }));
    expect(exit).toHaveBeenCalledOnce();
  });

  it("keeps one slide failed after another saves and retries only unsaved latest content", async () => {
    save.mockRejectedValueOnce(new Error("SYNTHETIC_PRIVATE_ERROR_CONTENT"));
    const data = fixture();
    const exit = vi.fn();
    render(<Editor data={data} onExit={exit} />);
    fireEvent.change(screen.getByLabelText("原稿全文"), {
      target: { value: "失敗した編集" },
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "スライド 1 を保存できません",
      ),
    );
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "スライド一覧" }),
      ).getAllByRole("button")[1],
    );
    fireEvent.change(screen.getByLabelText("原稿全文"), {
      target: { value: "保存できた編集" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "再保存" })).toBeEnabled(),
    );
    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent(
      "スライド 1 を保存できません",
    );
    expect(screen.getByRole("button", { name: "編集を終える" })).toBeDisabled();
    expect(
      screen.queryByText("SYNTHETIC_PRIVATE_ERROR_CONTENT"),
    ).not.toBeInTheDocument();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "再保存" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("保存済み"),
    );
    expect(save).toHaveBeenCalledTimes(3);
    expect(save.mock.calls[2][0]).toMatchObject({
      id: data.slides[0].id,
      fullScript: "失敗した編集",
      revision: 2,
    });
    expect(screen.getByRole("button", { name: "編集を終える" })).toBeEnabled();
  });

  it("enforces backup-compatible text and point limits", () => {
    const data = fixture();
    data.slides[0].keyPoints = Array.from({ length: 200 }, () => ({
      id: crypto.randomUUID(),
      text: "合成ポイント",
      required: true,
    }));
    render(<Editor data={data} onExit={vi.fn()} />);
    expect(screen.getByLabelText("原稿全文")).toHaveAttribute(
      "maxlength",
      "2000000",
    );
    expect(screen.getByLabelText("冒頭アンカーフレーズ")).toHaveAttribute(
      "maxlength",
      "2000000",
    );
    expect(screen.getByLabelText("ポイント 1")).toHaveAttribute(
      "maxlength",
      "2000000",
    );
    expect(
      screen.getByRole("button", { name: "ポイントを追加" }),
    ).toBeDisabled();
  });
});
