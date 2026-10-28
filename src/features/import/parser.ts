export type ParsedScript = {
  pages: { pageNumber: number; fullScript: string }[];
  warnings: string[];
  duplicates: number[];
  unassigned: number[];
};

/** Numbers are page addresses, never positions in a compacted list. */
export function parseScript(text: string, pdfPageCount?: number): ParsedScript {
  if (text.length > 10_000_000)
    throw new Error("原稿が大きすぎます。10 MB以内に分けてください。");
  const source = text.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  const matches = [
    ...source.matchAll(
      /^[ \t]*(?:slide|スライド)[ \t]*([0-9０-９]+)[ \t]*[:：][ \t]*/gim,
    ),
  ];
  const blocks = new Map<number, string[]>();
  const warnings: string[] = [];
  const duplicates: number[] = [];
  const stripBoundary = (value: string) =>
    value.replace(/^\n/, "").replace(/\n$/, "");
  if (!matches.length && source.trim()) {
    blocks.set(1, [source]);
    warnings.push(
      "スライド見出しがないため、全文をスライド1に割り当てました。必要に応じて編集してください。",
    );
  }
  if (matches[0]?.index && source.slice(0, matches[0].index).trim()) {
    warnings.push(
      "最初の見出しより前の文章は、最初のスライド原稿に残しています。",
    );
  }
  matches.forEach((match, index) => {
    const pageNumber = Number(
      match[1].replace(/[０-９]/g, (digit) =>
        String(digit.charCodeAt(0) - 0xff10),
      ),
    );
    if (
      !Number.isSafeInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > 1000
    ) {
      throw new Error("スライド番号は1〜1000を指定してください。");
    }
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    let content = stripBoundary(source.slice(start, end));
    if (index === 0 && match.index && source.slice(0, match.index).trim()) {
      content = `${stripBoundary(source.slice(0, match.index))}\n\n${content}`;
    }
    if (blocks.has(pageNumber) && !duplicates.includes(pageNumber))
      duplicates.push(pageNumber);
    blocks.set(pageNumber, [...(blocks.get(pageNumber) ?? []), content]);
  });
  const highest = Math.max(0, ...blocks.keys());
  const total = Math.max(pdfPageCount ?? 0, highest);
  const unassigned = Array.from({ length: total }, (_, i) => i + 1).filter(
    (n) => !blocks.has(n),
  );
  if (duplicates.length)
    warnings.push(
      `重複した番号（${duplicates.join("、")}）の原稿を順に結合しました。保存前に確認・編集してください。`,
    );
  if (unassigned.length)
    warnings.push(
      `原稿のないスライド（${unassigned.join("、")}）は空欄のままです。番号は詰めていません。`,
    );
  if (pdfPageCount && blocks.size !== pdfPageCount)
    warnings.push(
      `PDFは${pdfPageCount}ページ、原稿は${blocks.size}個の番号に割り当てられています。`,
    );
  if (pdfPageCount && highest > pdfPageCount)
    warnings.push(
      "PDFのページ数を超える原稿があります。該当スライドにはPDFが表示されません。",
    );
  return {
    pages: Array.from({ length: total }, (_, i) => ({
      pageNumber: i + 1,
      fullScript: (blocks.get(i + 1) ?? []).join("\n\n"),
    })),
    warnings,
    duplicates,
    unassigned,
  };
}
