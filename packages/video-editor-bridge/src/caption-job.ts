/**
 * The shapes a host's caption runner exchanges with the editor bundle: the
 * recognition job it hands the page, and what `transcribeTimelineSources`
 * returns for each source.
 */

/** One stretch of one source file the page is asked to recognize, in seconds of that file. */
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
