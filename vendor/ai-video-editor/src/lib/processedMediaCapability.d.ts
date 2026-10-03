import type { VideoEditorCapabilityRuntime, VideoEditorCapabilityRequest, VideoEditorCapabilityOutput, VideoEditorCapabilityTask, VideoEditorCapabilityProgress, JsonObject } from '../../../../packages/video-editor-bridge/src/host-contract.js';
export function startProcessedMedia(
 runtime: Pick<VideoEditorCapabilityRuntime, 'captureTimeline' | 'start' | 'complete' | 'cancel' | 'fail' | 'progress'>,
 options: { capability: VideoEditorCapabilityRequest['capability']; title: string; outputKind?: 'audio' | 'video'; source?: JsonObject; signal?: AbortSignal },
): Promise<{
 request: VideoEditorCapabilityRequest & { parameters: JsonObject };
 task: VideoEditorCapabilityTask;
 check(): void;
 progress(update: VideoEditorCapabilityProgress): Promise<void>;
 complete(files: NonNullable<VideoEditorCapabilityOutput['files']>): Promise<Array<Record<string, unknown> & { assetVersionId: string; sourceUrl: string }>>;
 fail(error: unknown): Promise<void>;
}>;
