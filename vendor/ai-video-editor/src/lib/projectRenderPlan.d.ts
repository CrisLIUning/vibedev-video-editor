export interface UpstreamFfmpegRenderPlan {
  args: string[];
  duration: number;
  width: number;
  height: number;
  frameRate: number;
  hasAudio: boolean;
  targetLoudnessLufs?: number;
  sidecars?: Array<{
    filename: string;
    content: string;
    sourcePath?: never;
  } | {
    filename: string;
    sourcePath: string;
    content?: never;
  }>;
}

export interface UpstreamFfmpegRenderMediaRequirements {
  visuals: Array<Record<string, unknown>>;
  overlays: Array<Record<string, unknown>>;
  stickers: Array<Record<string, unknown>>;
  audioSegments: Array<Record<string, unknown>>;
  musicSegments: Array<Record<string, unknown>>;
  /** FORK: video clips whose own sound plays, when the host finds a sound stream in their files. */
  sourceAudio: Array<Record<string, unknown>>;
  analyses: Array<Record<string, unknown>>;
}

export function getFfmpegRenderMediaRequirements(
  project?: Record<string, unknown>,
): UpstreamFfmpegRenderMediaRequirements;

export function buildFfmpegRenderPlan(input: {
  project: Record<string, unknown>;
  media?: Record<string, unknown>;
  extractedFiles: Map<string, string>;
  settings?: Record<string, unknown>;
  rendererResources?: {
    captionFonts?: Record<string, {
      path: string;
    }>;
  };
}): UpstreamFfmpegRenderPlan;

/** FORK: the visual filter ids the headless planner renders. */
export const SUPPORTED_VISUAL_FILTER_IDS: readonly string[];
