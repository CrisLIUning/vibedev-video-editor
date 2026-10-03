import type { VideoEditorAnalysisOutput } from '../../../../packages/video-editor-bridge/src/host-contract.js';

export function createSegmentationCapabilityOutput(input: {
  analysis: Record<string, unknown>;
  visualType: 'image' | 'video';
  targetKind: 'person' | 'object';
  source: VideoEditorAnalysisOutput['source'];
  model: VideoEditorAnalysisOutput['model'];
  encodeMaskVideo?: (
    blobs: Blob[],
    width: number,
    height: number,
    fps: number,
    keyframeTimes: number[],
    duration: number,
    options: { signal?: AbortSignal },
  ) => Promise<Blob>;
  encodeStillMask?: (blob: Blob, width: number, height: number, options: { signal?: AbortSignal }) => Promise<Blob>;
  signal?: AbortSignal;
}): Promise<{
  files: Array<{ blob: Blob; fileName: string; mimeType: string; title: string; analysisRole: string }>;
  analysisResult: VideoEditorAnalysisOutput;
}>;
