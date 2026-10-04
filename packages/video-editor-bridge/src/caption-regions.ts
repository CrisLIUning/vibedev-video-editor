/**
 * The shapes a host's caption runner exchanges with the editor bundle, and the
 * pure half of region extraction: turning Silero's speech regions into pieces
 * a text-only recognizer can be sent one at a time, and 16 kHz mono samples
 * into a WAV it accepts.
 *
 * A recognizer that answers text without timings (the VibeDev gateway today)
 * gets one request per region, and each caption takes its region's bounds.
 * That is coarser than Whisper's own timestamps but invents nothing: every
 * bound is where the voice detector heard speech start and stop.
 */

/** One stretch of one source file the page is asked to work on, in seconds of that file. */
export interface CaptionSourceInput {
  clipId: string;
  /** Where the page fetches the file (a host route serving its snapshot). */
  url: string;
  sourceIn: number;
  sourceOut: number;
}

/** A recognition job as the host hands it to the page. */
export interface CaptionJobInput {
  sources: CaptionSourceInput[];
  /** Model files by artifact id (`encoder-q8`, `speech-vad`, …), as URLs. */
  artifacts: Record<string, string>;
  language: string;
}

/**
 * What `transcribeTimelineSources` returns for one source. Segment times are
 * seconds from the start of the recognized stretch — 0 is `sourceIn` — which
 * is what Studio's `mapCaptionRecognition` adds `sourceIn` to.
 */
export interface TimelineSourceRecognition {
  sourceClipId: string;
  segments: Array<{ text: string; start: number; end: number; warnings?: string[] }>;
  diagnostics?: Record<string, unknown>;
}

/** A stretch where the voice detector heard speech, in seconds. */
export interface SpeechRegion {
  start: number;
  end: number;
}

/** One region of a source and its audio: seconds of the source file, a base64 16-bit PCM mono 16 kHz WAV. */
export interface ExtractedSpeechRegion extends SpeechRegion {
  wav: string;
}

/** What `extractTimelineAudio` returns for one source. */
export interface TimelineSourceExtraction {
  sourceClipId: string;
  regions: ExtractedSpeechRegion[];
}

/** Regions closer than this are sent as one, so a breath does not split a sentence. */
export const REGION_MERGE_GAP_SECONDS = 0.3;
/** …but a merge never grows a region past this. */
export const REGION_MERGE_MAX_SECONDS = 15;
/** A region longer than this is split at its quietest frame: recognizers do worse on long single requests. */
export const REGION_SPLIT_SECONDS = 30;
/** No piece of a split is shorter than this, so a split always makes progress. */
const MIN_PIECE_SECONDS = 1;

/**
 * Merge regions whose gap is under `gap` seconds while the merged region stays
 * within `max` seconds. Input order does not matter; the output is sorted.
 */
export function mergeSpeechRegions(regions: readonly SpeechRegion[], gap = REGION_MERGE_GAP_SECONDS, max = REGION_MERGE_MAX_SECONDS): SpeechRegion[] {
  const sorted = regions.map(region => ({ start: region.start, end: region.end })).sort((a, b) => a.start - b.start);
  const merged: SpeechRegion[] = [];
  for (const region of sorted) {
    const previous = merged.at(-1);
    if (previous && region.start - previous.end < gap && Math.max(previous.end, region.end) - previous.start <= max) {
      previous.end = Math.max(previous.end, region.end);
    } else {
      merged.push(region);
    }
  }
  return merged;
}

/**
 * Split every region longer than `limit` seconds at the frame with the lowest
 * speech probability. The split point is chosen so the left piece fits and,
 * when the region is short enough for two pieces, the right one does too; a
 * longer remainder is split again.
 * @param probabilities - Silero's probability per frame, frame 0 at time 0.
 * @param frameSeconds - the length of one frame (0.032 s for Silero at 16 kHz).
 */
export function splitLongRegions(regions: readonly SpeechRegion[], probabilities: readonly number[], frameSeconds: number, limit = REGION_SPLIT_SECONDS): SpeechRegion[] {
  const pieces: SpeechRegion[] = [];
  for (const region of regions) {
    let start = region.start;
    const end = region.end;
    while (end - start > limit) {
      const low = Math.max(start + MIN_PIECE_SECONDS, end - limit);
      const high = start + limit;
      const from = low <= high ? low : start + MIN_PIECE_SECONDS;
      let split = high;
      let quietest = Infinity;
      const first = Math.ceil(from / frameSeconds);
      const last = Math.floor(high / frameSeconds);
      for (let frame = first; frame <= last; frame += 1) {
        const probability = probabilities[frame];
        if (probability !== undefined && probability < quietest) {
          quietest = probability;
          split = frame * frameSeconds;
        }
      }
      pieces.push({ start, end: split });
      start = split;
    }
    pieces.push({ start, end });
  }
  return pieces;
}

/** The regions a text-only recognizer is sent: merged, then split. */
export function planSpeechRegions(regions: readonly SpeechRegion[], probabilities: readonly number[], frameSeconds: number): SpeechRegion[] {
  return splitLongRegions(mergeSpeechRegions(regions), probabilities, frameSeconds);
}

/** A 16-bit PCM mono WAV of `samples` (−1…1) at `sampleRate`. */
export function encodePcm16Wav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  text(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]!));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return bytes;
}

/** Base64 of bytes, in pieces small enough for `String.fromCharCode`. */
export function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** Whether every sample is exactly zero: digital silence, the only "no speech" decided without the detector. */
export function isDigitalSilence(samples: Float32Array): boolean {
  for (let index = 0; index < samples.length; index += 1) if (samples[index] !== 0) return false;
  return true;
}
