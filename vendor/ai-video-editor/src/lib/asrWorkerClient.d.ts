export interface AsrWorkerProgress {
  progress?: number;
  phase?: string;
}

export interface AsrWorkerResult {
  output: unknown;
  language: string;
  languageDetected: boolean;
  modelId: string;
}

export interface InterruptibleAsrWorkerClient {
  transcribe(
    audio: Float32Array,
    options?: {
      onProgress?: (update: AsrWorkerProgress) => void;
      preferredLanguage?: string;
      signal?: AbortSignal;
      modelId?: string;
      modelArtifacts?: Record<string, string>;
    },
  ): Promise<AsrWorkerResult>;
  reset(error?: Error): void;
  dispose(): void;
}

export function createInterruptibleAsrWorkerClient(options: {
  createWorker: () => Worker | null;
  createRequestId: () => string;
}): InterruptibleAsrWorkerClient;
