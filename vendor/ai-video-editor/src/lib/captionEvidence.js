/** Keep original words/times. Bounded terminal overruns remain explicitly estimated. */
export function captionEvidence(output, duration, offset = 0) {
  const rejected = [], segments = [], adjustments = [];
  const chunks = output?.chunks ?? [];
  for (const [index, chunk] of chunks.entries()) {
    const text = String(chunk?.text ?? "").replace(/\s+/g, " ").trim();
    const ts = chunk?.timestamp;
    if (!text) continue;
    const numeric = Array.isArray(ts) && ts.length === 2 && ts.every(v => typeof v === "number" && Number.isFinite(v));
    // Real Whisper fixture: a final 3.621s utterance reports a 4s end. Only a
    // small final overrun may be bounded by the decoded file end, never a volume
    // peak or invented default duration. All original values remain evidence.
    const clipped = numeric && index === chunks.length - 1 && ts[0] >= 0 && ts[0] < duration && ts[1] > duration
      && ts[1] - duration <= Math.min(0.5, (ts[1] - ts[0]) * 0.15)
      && (!chunk.region || Math.abs(chunk.region.end - duration) <= 0.001);
    const end = clipped ? duration : numeric ? ts[1] : NaN;
    if (!numeric || ts[0] < 0 || end <= ts[0] || end > duration
      || (chunk.region && (ts[0] < chunk.region.start - 0.1 || end > chunk.region.end + 0.1))
      || (segments.length && ts[0] + offset < segments.at(-1).end - 0.05)) {
      rejected.push({ index, text, timestamp: ts ?? null, reason: "missing-or-invalid-timestamp" });
      continue;
    }
    if (clipped) adjustments.push({ index, rawStart: ts[0], rawEnd: ts[1], start: ts[0], end, reason: "bounded-file-end-overrun", estimated: true });
    segments.push({ id: `asr-draft-${index}`, text, rawText: String(chunk.text), start: ts[0] + offset,
      end: end + offset, rawStart: ts[0], rawEnd: ts[1], timingSource: clipped ? "whisper-segment-clipped" : "whisper-segment",
      warnings: clipped ? ["estimated-end-clipped-to-audio"] : [], reviewStatus: "unreviewed", source: "asr", hidden: false });
  }
  if (!chunks.length && output?.text) rejected.push({ text: output.text, timestamp: null, reason: "missing-timestamps" });
  return { segments, rejected, adjustments };
}
