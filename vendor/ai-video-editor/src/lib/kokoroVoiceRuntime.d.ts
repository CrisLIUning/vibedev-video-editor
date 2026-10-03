export function configureKokoroHostModelFiles(
  environment: Record<string, unknown>,
  modelArtifacts?: Record<string, string>,
): boolean;

export function predictKokoroVoice(
  input: {
    text: string;
    voiceId: string;
    speed?: number;
    modelArtifacts?: Record<string, string>;
  },
  onProgress?: (event: Record<string, unknown>) => void,
): Promise<Blob>;

export function clearKokoroVoiceCacheIfStorageTight(): Promise<boolean>;
