export function mapAiMusicWorkerProgress(
  progress: unknown,
  hostedRuntime?: boolean,
): number;

export function advanceAiMusicProgress(
  currentProgress: unknown,
  workerProgress: unknown,
  hostedRuntime?: boolean,
): number;

export function resolveAiMusicExecutionProviders(
  navigatorLike?: {
    userAgent?: string;
    gpu?: { requestAdapter(options?: { powerPreference?: string }): Promise<unknown> };
  },
): Promise<Array<'webgpu' | 'wasm'>>;
