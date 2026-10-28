import type JSZip from "jszip";

export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
export const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 601;
export type ZipEntry = {
  name: string;
  size: number;
  compressedSize: number;
  crc: number;
};
const fail = () =>
  new Error(
    "ZIPの構造が不正か、対応するサイズ・ファイル数の上限を超えています。",
  );
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Validate central and local headers before asking a decompressor to allocate output. */
export function inspectZip(bytes: Uint8Array): Map<string, ZipEntry> {
  if (bytes.length < 22 || bytes.length > MAX_BACKUP_BYTES) throw fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  const firstPossibleEnd = Math.max(0, end - 65535);
  while (
    end >= firstPossibleEnd &&
    (view.getUint32(end, true) !== 0x06054b50 ||
      end + 22 + view.getUint16(end + 20, true) !== bytes.length)
  )
    end--;
  if (end < firstPossibleEnd) throw fail();
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralStart = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0 ||
    view.getUint16(end + 8, true) !== count ||
    count > MAX_FILES ||
    centralStart + centralSize !== end ||
    centralSize > 256 * 1024 ||
    centralStart >= end
  )
    throw fail();
  const entries = new Map<string, ZipEntry>();
  const localRanges: { start: number; end: number }[] = [];
  let position = centralStart;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50)
      throw fail();
    const flags = view.getUint16(position + 8, true);
    const method = view.getUint16(position + 10, true);
    const crc = view.getUint32(position + 16, true);
    const compressedSize = view.getUint32(position + 20, true);
    const size = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const localStart = view.getUint32(position + 42, true);
    if (
      position + 46 + nameLength + extraLength + commentLength > end ||
      (flags & ~0x0808) !== 0 ||
      ![0, 8].includes(method) ||
      view.getUint16(position + 34, true) !== 0
    )
      throw fail();
    const name = decoder.decode(
      bytes.subarray(position + 46, position + 46 + nameLength),
    );
    const allowed =
      name === "manifest.json" ||
      /^projects\/[0-9a-f-]{36}\/(?:project\.json|slides\.json|sessions\.json|attempts\.json|presentation\.pdf)$/i.test(
        name,
      );
    if (
      !allowed ||
      entries.has(name) ||
      size > (name.endsWith(".pdf") ? MAX_PDF_BYTES : MAX_JSON_BYTES) ||
      size === 0 ||
      compressedSize === 0 ||
      size / compressedSize > 1000
    )
      throw fail();
    total += size;
    if (
      total > MAX_BACKUP_BYTES ||
      localStart + 30 > centralStart ||
      view.getUint32(localStart, true) !== 0x04034b50
    )
      throw fail();
    const localNameLength = view.getUint16(localStart + 26, true);
    const localExtraLength = view.getUint16(localStart + 28, true);
    const dataStart = localStart + 30 + localNameLength + localExtraLength;
    if (
      dataStart + compressedSize > centralStart ||
      decoder.decode(
        bytes.subarray(localStart + 30, localStart + 30 + localNameLength),
      ) !== name ||
      view.getUint16(localStart + 6, true) !== flags ||
      view.getUint16(localStart + 8, true) !== method
    )
      throw fail();
    if (
      !(flags & 8) &&
      (view.getUint32(localStart + 14, true) !== crc ||
        view.getUint32(localStart + 18, true) !== compressedSize ||
        view.getUint32(localStart + 22, true) !== size)
    )
      throw fail();
    localRanges.push({ start: localStart, end: dataStart + compressedSize });
    entries.set(name, { name, size, compressedSize, crc });
    position += 46 + nameLength + extraLength + commentLength;
  }
  if (position !== end) throw fail();
  localRanges.sort((a, b) => a.start - b.start);
  if (
    localRanges.some(
      (range, index) => index > 0 && range.start < localRanges[index - 1].end,
    )
  )
    throw fail();
  return entries;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++)
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

/** Stop inflation as soon as actual output exceeds the validated declaration. */
export function readBounded(
  file: JSZip.JSZipObject,
  entry: ZipEntry,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    // JSZip documents this public streaming API, but its bundled legacy types omit it.
    const streamingFile = file as JSZip.JSZipObject & {
      internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
    };
    const stream = streamingFile.internalStream("uint8array");
    const output = new Uint8Array(entry.size);
    let length = 0;
    let crc = 0xffffffff;
    let failed = false;
    stream.on("data", (chunk: Uint8Array) => {
      if (failed) return;
      if (length + chunk.length > entry.size) {
        failed = true;
        stream.pause();
        reject(fail());
        return;
      }
      output.set(chunk, length);
      length += chunk.length;
      for (const byte of chunk)
        crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    });
    stream.on("error", () => {
      failed = true;
      reject(fail());
    });
    stream.on("end", () => {
      if (failed) return;
      if (length !== entry.size || (crc ^ 0xffffffff) >>> 0 !== entry.crc)
        reject(fail());
      else resolve(output);
    });
    stream.resume();
  });
}
