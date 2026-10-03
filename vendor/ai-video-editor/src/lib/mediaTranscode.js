// FORK: the editor's file conversions on mediabunny and the browser's own
// WebCodecs instead of ffmpeg.wasm.
//
// @ffmpeg/core is GPL-2.0-or-later, and VibeDev ships this editor inside
// packages anyone can download. The deterministic export already encodes with
// mediabunny (MPL-2.0); these five conversions were what kept the GPL build in
// the bundle. They keep their signatures and results — WAV for sound taken out
// of a file, MP4 for video — so their callers did not change.
//
// What the browser cannot decode, these cannot convert: ffmpeg.wasm decoded
// everything in software. A source in such a codec (MPEG-2, VC-1, AC-3 on a
// browser without it) now fails with that reason instead of converting.

import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Conversion,
  ConversionCanceledError,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_VERY_HIGH,
  WavOutputFormat,
  getFirstEncodableVideoCodec,
} from "mediabunny";

import { ensureAacEncoder } from "./aacFallback.js";
import { getGeneratedMediaTags } from "./generatedMediaMetadata.js";
import { silentSourceError } from "./sourceAudioAvailability.js";

const AUDIO_BITRATE = 192_000;

const DISCARD_REASONS = {
  undecodable_source_codec: "这个浏览器解不了它的编码",
  unknown_source_codec: "编码无法识别",
  no_encodable_target_codec: "这个浏览器没有能用的编码器",
  max_track_count_reached: "输出格式放不下这条轨道",
  max_track_count_of_type_reached: "输出格式放不下这条轨道",
};

function createAbortError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function openInput(blob) {
  return new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
}

function trackLabel(track) {
  const kind = track.type === "video" ? "画面" : track.type === "audio" ? "声音" : "轨道";
  return track.codec ? `${kind}（${track.codec}）` : kind;
}

/** The tracks a conversion had to leave out, other than those it was told to. */
function lostTracks(conversion) {
  return conversion.discardedTracks.filter(({ reason }) => reason !== "discarded_by_user");
}

function conversionError(conversion, what) {
  const reasons = lostTracks(conversion)
    .map(({ track, reason }) => `${trackLabel(track)}：${DISCARD_REASONS[reason] || reason}`);
  return new Error(`${what}：${reasons.join("；") || "没有可以转换的轨道"}`);
}

async function runConversion(conversion, signal, abortMessage) {
  if (signal?.aborted) throw createAbortError(abortMessage);
  const cancel = () => { void conversion.cancel(); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    await conversion.execute();
  } catch (error) {
    if (signal?.aborted || error instanceof ConversionCanceledError) throw createAbortError(abortMessage);
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

/**
 * The file's sound as 16-bit PCM WAV, or null when the file was read and holds
 * no audio stream. A file that cannot be read at all, or whose sound cannot be
 * decoded, throws: missing sound is never allowed to pass for silence.
 */
async function soundAsWav(blob, { sampleRate, numberOfChannels }) {
  const input = openInput(blob);
  try {
    const tracks = await input.getTracks();
    if (tracks.length === 0) throw new Error("读不出这个文件里的任何轨道");
    if (!tracks.some((track) => track.type === "audio")) return null;
    const target = new BufferTarget();
    const output = new Output({ format: new WavOutputFormat(), target });
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      showWarnings: false,
      video: { discard: true },
      audio: { codec: "pcm-s16", sampleRate, numberOfChannels },
    });
    if (!conversion.isValid || lostTracks(conversion).length > 0) throw conversionError(conversion, "取不出声音");
    await runConversion(conversion);
    return new Blob([target.buffer], { type: "audio/wav" });
  } finally {
    input.dispose();
  }
}

export async function extractAudioFromVideo(videoBlob, _filename = "source-video.mp4") {
  const wav = await soundAsWav(videoBlob, { sampleRate: 44_100, numberOfChannels: 2 });
  if (!wav) throw silentSourceError();
  return wav;
}

export async function transcodeAudioToWav(audioBlob, _filename = "source-audio.bin") {
  const wav = await soundAsWav(audioBlob, { sampleRate: 48_000, numberOfChannels: 2 });
  if (!wav) throw new Error("这个文件里没有声音");
  return wav;
}

export async function transcodeWebmToMp4(webmBlob, {
  signal,
  generationMetadata = null,
  copyStreams = false,
} = {}) {
  const abortMessage = "Export canceled";
  if (signal?.aborted) throw createAbortError(abortMessage);
  ensureAacEncoder();
  const input = openInput(webmBlob);
  try {
    const target = new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory", metadataFormat: "mdta" }),
      target,
    });
    const tags = getGeneratedMediaTags(generationMetadata);
    const conversion = await Conversion.init({
      input,
      output,
      showWarnings: false,
      // Copying keeps the recorder's streams and only rewrites the container
      // and its tags; otherwise the file gets the codecs every player takes.
      video: copyStreams ? {} : { codec: "avc", bitrate: QUALITY_HIGH, forceTranscode: true },
      audio: copyStreams ? {} : { codec: "aac", bitrate: AUDIO_BITRATE },
      ...(tags ? { tags } : {}),
    });
    if (!conversion.isValid || lostTracks(conversion).length > 0) throw conversionError(conversion, "转不成 MP4");
    await runConversion(conversion, signal, abortMessage);
    return new Blob([target.buffer], { type: "video/mp4" });
  } finally {
    input.dispose();
  }
}

/**
 * The picture of `videoBlob` with the sound of `audioBlob`, in MP4. The picture
 * is copied as it is; the sound (decoded audio, usually WAV) is encoded to AAC.
 */
async function withSound(videoBlob, audioBlob) {
  const videoInput = openInput(videoBlob);
  const audioInput = openInput(audioBlob);
  let output = null;
  try {
    const videoTrack = await videoInput.getPrimaryVideoTrack();
    const audioTrack = await audioInput.getPrimaryAudioTrack();
    if (!videoTrack) throw new Error("转换后的视频里没有画面");
    if (!audioTrack) throw new Error("解出的声音文件里没有声音");
    if (!(await audioTrack.canDecode())) throw new Error(`${trackLabel(audioTrack)}：${DISCARD_REASONS.undecodable_source_codec}`);
    const decoderConfig = await videoTrack.getDecoderConfig();
    const target = new BufferTarget();
    output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
    const videoSource = new EncodedVideoPacketSource(videoTrack.codec);
    const audioSource = new AudioBufferSource({ codec: "aac", bitrate: AUDIO_BITRATE });
    output.addVideoTrack(videoSource, { rotation: videoTrack.rotation });
    output.addAudioTrack(audioSource);
    await output.start();
    await Promise.all([
      (async () => {
        let first = true;
        for await (const packet of new EncodedPacketSink(videoTrack).packets()) {
          await videoSource.add(packet, first && decoderConfig ? { decoderConfig } : undefined);
          first = false;
        }
        videoSource.close();
      })(),
      (async () => {
        for await (const { buffer } of new AudioBufferSink(audioTrack).buffers()) await audioSource.add(buffer);
        audioSource.close();
      })(),
    ]);
    await output.finalize();
    return new Blob([target.buffer], { type: "video/mp4" });
  } catch (error) {
    await output?.cancel().catch(() => {});
    throw error;
  } finally {
    videoInput.dispose();
    audioInput.dispose();
  }
}

/**
 * A video the browser cannot play (an MKV, say) as an MP4 it can. The picture
 * is copied when MP4 can hold its codec and re-encoded otherwise; the sound is
 * AAC. `decodedAudioBlob` is the sound libav.js already decoded, for a source
 * whose own audio codec the browser cannot decode.
 */
export async function normalizeVideoForEditing(videoBlob, _filename = "source-video.mkv", { decodedAudioBlob = null } = {}) {
  ensureAacEncoder();
  const input = openInput(videoBlob);
  let pictureOnly;
  try {
    if (!(await input.getPrimaryVideoTrack())) throw new Error("这个文件里没有画面");
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      showWarnings: false,
      video: {},
      audio: decodedAudioBlob ? { discard: true } : { codec: "aac" },
    });
    // A picture without its sound would be a quiet loss; both must convert.
    if (!conversion.isValid || lostTracks(conversion).length > 0) throw conversionError(conversion, "这个视频转不成可编辑的格式");
    await runConversion(conversion);
    const converted = new Blob([target.buffer], { type: "video/mp4" });
    if (!decodedAudioBlob) return converted;
    pictureOnly = converted;
  } finally {
    input.dispose();
  }
  return withSound(pictureOnly, decodedAudioBlob);
}

/** A copy of `buffer` from `from` to `to` seconds into it. */
function sliceAudioBuffer(buffer, from, to) {
  const start = Math.max(0, Math.min(buffer.length, Math.round(from * buffer.sampleRate)));
  const end = Math.max(start, Math.min(buffer.length, Math.round(to * buffer.sampleRate)));
  if (start === 0 && end === buffer.length) return buffer;
  if (end === start) return null;
  const slice = new AudioBuffer({ length: end - start, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    slice.copyToChannel(buffer.getChannelData(channel).subarray(start, end), channel);
  }
  return slice;
}

/** Feed `[start, end)` seconds of the track's sound to `source`, from 0. */
async function addSoundSection(track, source, start, end) {
  for await (const wrapped of new AudioBufferSink(track).buffers(start, end)) {
    const from = Math.max(start, wrapped.timestamp);
    const to = Math.min(end, wrapped.timestamp + wrapped.duration);
    if (to <= from) continue;
    const section = sliceAudioBuffer(wrapped.buffer, from - wrapped.timestamp, to - wrapped.timestamp);
    if (section) await source.add(section);
  }
  source.close();
}

export async function encodePngFrameSequence({
  totalFrames,
  frameRate,
  produceFrame,
  signal,
  onProgress,
  audioSourceBlob = null,
  audioStart = 0,
  audioDuration = 0,
}) {
  const abortMessage = "整段增强已取消";
  const throwIfAborted = () => { if (signal?.aborted) throw createAbortError(abortMessage); };
  throwIfAborted();
  const frameBlobs = [];
  for (let index = 0; index < totalFrames; index += 1) {
    throwIfAborted();
    const blob = await produceFrame(index);
    throwIfAborted();
    frameBlobs.push(blob);
  }
  if (frameBlobs.length === 0) throw new Error("没有可以编码的画面");
  onProgress?.({ progress: 91, phaseKey: "remasterPhaseLoadEncoder" });

  const firstFrame = await createImageBitmap(frameBlobs[0]);
  // H.264 takes even sizes only; an odd edge is scaled in by a pixel.
  const width = Math.max(2, firstFrame.width - (firstFrame.width % 2));
  const height = Math.max(2, firstFrame.height - (firstFrame.height % 2));
  const codec = await getFirstEncodableVideoCodec(["avc", "vp9", "av1"], { width, height });
  if (!codec) {
    firstFrame.close();
    throw new Error("这个浏览器没有能用的视频编码器");
  }
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { alpha: false });

  const audioInput = audioSourceBlob instanceof Blob ? openInput(audioSourceBlob) : null;
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const cancel = () => { void output.cancel().catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const videoSource = new CanvasSource(canvas, { codec, bitrate: QUALITY_VERY_HIGH, keyFrameInterval: 2 });
    output.addVideoTrack(videoSource, { frameRate });
    // The source's sound, when it has any, cut to the section and to the
    // picture's length.
    const audioTrack = audioInput ? await audioInput.getPrimaryAudioTrack() : null;
    let audioSource = null;
    if (audioTrack) {
      if (!(await audioTrack.canDecode())) throw new Error(`${trackLabel(audioTrack)}：${DISCARD_REASONS.undecodable_source_codec}`);
      ensureAacEncoder();
      audioSource = new AudioBufferSource({ codec: "aac", bitrate: AUDIO_BITRATE });
      output.addAudioTrack(audioSource);
    }
    await output.start();
    const pictureSeconds = frameBlobs.length / frameRate;
    const soundStart = Math.max(0, Number(audioStart) || 0);
    const soundEnd = soundStart + Math.min(pictureSeconds, audioDuration > 0 ? audioDuration : Infinity);
    const soundWork = audioSource ? addSoundSection(audioTrack, audioSource, soundStart, soundEnd) : Promise.resolve();
    onProgress?.({ progress: 92, phaseKey: "remasterPhaseEncodeVideo" });
    for (let index = 0; index < frameBlobs.length; index += 1) {
      throwIfAborted();
      const bitmap = index === 0 ? firstFrame : await createImageBitmap(frameBlobs[index]);
      try {
        context.drawImage(bitmap, 0, 0, width, height);
      } finally {
        bitmap.close();
      }
      await videoSource.add(index / frameRate, 1 / frameRate);
    }
    videoSource.close();
    await soundWork;
    throwIfAborted();
    await output.finalize();
    onProgress?.({ progress: 99, phaseKey: "remasterPhaseCreateAsset" });
    return new Blob([target.buffer], { type: "video/mp4" });
  } catch (error) {
    await output.cancel().catch(() => {});
    if (signal?.aborted) throw createAbortError(abortMessage);
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    firstFrame.close();
    audioInput?.dispose();
  }
}
