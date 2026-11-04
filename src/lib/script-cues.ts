import type { Slide } from "../domain/types";

// All cues are generated locally. The original script is never modified.
const terminalMarks = new Set(["。", "！", "？", "!", "?"]);
const closingMarks = new Set(["」", "』", "）", "】", "”", "’"]);
const digit = (character: string | undefined) =>
  character !== undefined && /^[0-9０-９]$/.test(character);

/**
 * Split a script into spoken sentences without relying on an AI or network API.
 * Blank lines separate paragraphs. Soft wraps inside Japanese words are joined.
 */
export function scriptSentences(source: string): string[] {
  if (!source.trim()) return [];
  const result: string[] = [];
  const paragraphs = source
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n\s*\n/);
  for (const original of paragraphs) {
    const paragraph = original
      .replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\n(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu, "$1")
      .replace(/[ \t]*\n[ \t]*/g, " ")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    let start = 0;
    for (let i = 0; i < paragraph.length; i++) {
      const current = paragraph[i];
      const period = current === "." && !(
        digit(paragraph[i - 1]) && digit(paragraph[i + 1])
      ) && (i + 1 === paragraph.length || /\s/.test(paragraph[i + 1]) || closingMarks.has(paragraph[i + 1]));
      if (!terminalMarks.has(current) && !period) continue;
      let end = i + 1;
      while (end < paragraph.length && terminalMarks.has(paragraph[end])) end++;
      while (end < paragraph.length && closingMarks.has(paragraph[end])) end++;
      const sentence = paragraph.slice(start, end).trim();
      if (sentence) result.push(sentence);
      start = end;
      i = end - 1;
    }
    const remaining = paragraph.slice(start).trim();
    if (remaining) result.push(remaining);
  }
  return result;
}

/** Manual anchors win; missing anchors are inferred from the current text. */
export function openingForSlide(slide: Pick<Slide, "openingExact" | "fullScript">): string {
  return slide.openingExact ?? scriptSentences(slide.fullScript)[0] ?? "";
}
export function closingForSlide(slide: Pick<Slide, "closingExact" | "fullScript">): string {
  if (slide.closingExact !== undefined) return slide.closingExact;
  const sentences = scriptSentences(slide.fullScript);
  return sentences.length > 1 ? sentences[sentences.length - 1] : "";
}

/** Unicode code points rather than UTF-16 units keep surrogate pairs intact. */
export function sentenceLeadHints(source: string, characters: number): string[] {
  const length = Math.max(1, Math.min(100, Math.floor(characters)));
  return scriptSentences(source).map((sentence) => {
    const letters = Array.from(sentence);
    return letters.length > length
      ? letters.slice(0, length).join("") + "……"
      : sentence;
  });
}
