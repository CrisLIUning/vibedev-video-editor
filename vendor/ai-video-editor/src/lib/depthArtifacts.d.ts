import type { VideoEditorAnalysisOutput } from '../../../../packages/video-editor-bridge/src/host-contract.js';

export function createDepthCapabilityOutput(input: {
  analysis: Record<string, unknown>;
  source: VideoEditorAnalysisOutput['source'];
  model: VideoEditorAnalysisOutput['model'];
  encodeFrames?: (blobs: Blob[], width: number, height: number, fps: number, times: number[], duration: number, options: { signal?: AbortSignal }) => Promise<Blob>;
  signal?: AbortSignal;
}): Promise<{
  files: Array<{ blob: Blob; fileName: string; mimeType: string; title: string; analysisRole: string }>;
  analysisResult: VideoEditorAnalysisOutput;
}>;
