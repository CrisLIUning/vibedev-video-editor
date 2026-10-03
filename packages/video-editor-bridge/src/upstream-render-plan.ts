import {
  buildFfmpegRenderPlan,
  getFfmpegRenderMediaRequirements,
  type UpstreamFfmpegRenderPlan,
  type UpstreamFfmpegRenderMediaRequirements,
} from '../../../vendor/ai-video-editor/src/lib/projectRenderPlan.js';

export interface NativeTimelineFfmpegPlanInput {
  project: Record<string, unknown>;
  media?: Record<string, unknown>;
  extractedFiles: Map<string, string>;
  settings?: Record<string, unknown>;
  rendererResources?: {
    captionFonts?: Record<string, {
      path: string;
    }>;
  };
}

/** Thin typed boundary over the pinned upstream headless planner. Keeping the
 * call here lets VibeDev reuse upstream feature support as it grows while the
 * daemon remains insulated from vendored source paths. */
export function buildNativeTimelineFfmpegPlan(
  input: NativeTimelineFfmpegPlanInput,
): UpstreamFfmpegRenderPlan {
  return buildFfmpegRenderPlan(input);
}

export function getNativeTimelineFfmpegMediaRequirements(
  project: Record<string, unknown>,
): UpstreamFfmpegRenderMediaRequirements {
  return getFfmpegRenderMediaRequirements(project);
}

export type { UpstreamFfmpegRenderMediaRequirements, UpstreamFfmpegRenderPlan };
