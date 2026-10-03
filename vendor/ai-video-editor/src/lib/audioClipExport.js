import { encodeAudioBufferAsWav, extractAudioFromVideo } from "./media.js";
import { loadAuthorizedAudioSegmentMedia } from "./hostAuthorizedMedia.js";
import { mixOfflineAudio } from "./offlineVideoExport.js";

/** Export the selected audible interval, not its untrimmed backing video. */
export async function renderAudioClipFile(segment, authorizedAssets = [], { signal } = {}) {
  signal?.throwIfAborted();
  if (segment && !(segment.blob instanceof Blob)) {
    [segment] = await loadAuthorizedAudioSegmentMedia([segment], authorizedAssets, { signal, extractVideoAudio: extractAudioFromVideo });
  }
  signal?.throwIfAborted();
  if (!(segment?.blob instanceof Blob) || !segment.blob.size) throw new Error("音频原文件不可用");
  const duration = Number(segment.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("音频片段时长无效");
  const buffer = await mixOfflineAudio({ duration, voiceAudioSegments: [{ ...segment, start: 0 }] });
  signal?.throwIfAborted();
  if (!buffer) throw new Error("音频渲染未产生输出");
  return { kind: "audio", durationSeconds: buffer.duration, name: `${String(segment.name || "分离音频").replace(/\.[^.]+$/, "")}.wav`, blob: encodeAudioBufferAsWav(buffer) };
}
