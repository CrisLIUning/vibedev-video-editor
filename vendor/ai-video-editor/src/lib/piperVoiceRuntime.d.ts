export function isBuiltInPinyinVoice(voiceId: string): boolean;

export function resolvePiperModelRoutes(
  tts: { HF_BASE?: string; PATH_MAP?: Record<string, string> },
  input: { voiceId: string; modelArtifacts?: Record<string, string> },
): Promise<Map<string, string[]>>;

export function predictPiperVoice(
  tts: unknown,
  input: {
    text: string;
    voiceId: string;
    speed?: number;
    modelArtifacts?: Record<string, string>;
  },
  onProgress?: (event: Record<string, unknown>) => void,
): Promise<Blob>;
