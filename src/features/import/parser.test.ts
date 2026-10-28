import { describe, expect, it } from "vitest";
import { parseScript } from "./parser";

describe("script page mapping", () => {
  it("preserves one-based addresses and interior newlines across heading variants", () => {
    const result = parseScript(
      "Slide 1: First\r\nsecond\r\n\r\nparagraph\r\nスライド ３： third\r\nsLiDe 4：fourth",
      4,
    );
    expect(result.pages).toEqual([
      { pageNumber: 1, fullScript: "First\nsecond\n\nparagraph" },
      { pageNumber: 2, fullScript: "" },
      { pageNumber: 3, fullScript: "third" },
      { pageNumber: 4, fullScript: "fourth" },
    ]);
    expect(result.unassigned).toEqual([2]);
    expect(result.warnings).not.toEqual([]);
  });
  it("retains duplicate text in source order and reports the collision", () => {
    const result = parseScript("Slide 2: A\nSlide 2: B\nSlide 5: C", 3);
    expect(result.duplicates).toEqual([2]);
    expect(result.pages[1].fullScript).toBe("A\n\nB");
    expect(result.pages[4].fullScript).toBe("C");
    expect(result.pages[2].fullScript).toBe("");
    expect(result.warnings.some((warning) => warning.includes("超える"))).toBe(
      true,
    );
  });
  it("supports script-only and PDF-only projects without inventing scripts", () => {
    expect(parseScript("", 3).pages.map((page) => page.fullScript)).toEqual([
      "",
      "",
      "",
    ]);
    expect(parseScript("plain\ntext").pages).toEqual([
      { pageNumber: 1, fullScript: "plain\ntext" },
    ]);
    expect(parseScript("")).toEqual({
      pages: [],
      warnings: [],
      duplicates: [],
      unassigned: [],
    });
  });
  it("preserves preamble and rejects invalid or unbounded numbering", () => {
    expect(parseScript("Preface\nSlide 2: body").pages[1].fullScript).toBe(
      "Preface\n\nbody",
    );
    expect(() => parseScript("Slide 0: body")).toThrow();
    expect(() => parseScript("Slide 999999999999999: body")).toThrow();
  });
});
