import { describe, expect, it } from "vitest";
import {
  closingForSlide,
  openingForSlide,
  scriptSentences,
  sentenceLeadHints,
} from "./script-cues";

describe("offline script-derived cues", () => {
  const script =
    "本日はこのような機会をいただき、ありがとうございます。\n" +
    "東京科学大学臨床解剖学分野の室生暁と申します。\n\n" +
    "「人体構造学分野の継承と発展」をテーマにお話しします。";

  it("splits Japanese sentences and makes progressively longer first-character hints", () => {
    expect(scriptSentences(script)).toHaveLength(3);
    expect(sentenceLeadHints(script, 3)).toEqual([
      "本日は……",
      "東京科……",
      "「人体……",
    ]);
    expect(sentenceLeadHints(script, 8)).toEqual([
      "本日はこのような……",
      "東京科学大学臨床……",
      "「人体構造学分野……",
    ]);
  });

  it("auto-derives opening and closing for newly imported and existing slides", () => {
    expect(openingForSlide({ fullScript: script })).toBe(
      "本日はこのような機会をいただき、ありがとうございます。",
    );
    expect(closingForSlide({ fullScript: script })).toBe(
      "「人体構造学分野の継承と発展」をテーマにお話しします。",
    );
    expect(openingForSlide({ fullScript: "新しい原稿。" })).toBe("新しい原稿。");
    expect(closingForSlide({ fullScript: "一文だけ。" })).toBe("");
  });

  it("never overwrites manually edited anchors", () => {
    expect(openingForSlide({ fullScript: script, openingExact: "手動冒頭" })).toBe("手動冒頭");
    expect(closingForSlide({ fullScript: script, closingExact: "手動結論" })).toBe("手動結論");
    expect(openingForSlide({ fullScript: script, openingExact: "" })).toBe("");
    expect(openingForSlide({ fullScript: "変更後の原稿。新しい締め。" })).toBe("変更後の原稿。");
  });

  it("handles decimals, blank scripts, punctuation and wrapped Japanese text", () => {
    expect(scriptSentences("値は3.14です。\n次も確認します！")).toEqual([
      "値は3.14です。",
      "次も確認します！",
    ]);
    expect(scriptSentences("広\nがっています。\nその後です。")).toEqual([
      "広がっています。",
      "その後です。",
    ]);
    expect(scriptSentences("  ")).toEqual([]);
    expect(sentenceLeadHints("  ", 3)).toEqual([]);
    expect(sentenceLeadHints("短い。", 8)).toEqual(["短い。"]);
    expect(sentenceLeadHints("😀こんにちは。", 3)[0]).toBe("😀こん……");
  });
});
