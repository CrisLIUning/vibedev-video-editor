export interface EditorVoice {
  id: string;
  name: string;
  language: string;
  detail: string;
  gender: string;
  engine: string;
  defaultSpeed?: number;
  badge?: string;
  avatarUrl: string;
  sampleUrl: string;
}

export const VOICES: readonly EditorVoice[];
