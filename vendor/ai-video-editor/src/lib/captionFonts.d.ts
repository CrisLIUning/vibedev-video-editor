export interface CaptionFontDefinition {
  id: string;
  family: string;
  label: string;
  weight: number;
  category: string;
  sample: string;
  googleFamily: string;
  file: string;
  fallback: string;
  license: string;
}

export interface CaptionFontHostRuntime {
  prepareModel(request: { modelId: string }): Promise<{
    modelId: string;
    revision: string;
    artifacts: Record<string, string>;
  }>;
}

export const DEFAULT_CAPTION_FONT_ID: 'default';
export const CAPTION_FONT_REPOSITORY: string;
export const CAPTION_FONT_REVISION: string;
export const CAPTION_FONT_CATALOG: CaptionFontDefinition[];

export function configureCaptionFontHostRuntime(
  runtime?: CaptionFontHostRuntime | null,
): void;
export function getCaptionFont(fontId?: string): CaptionFontDefinition;
export function getCaptionFontsForLanguage(language?: string): CaptionFontDefinition[];
export function resolveCaptionFontFamily(fontId: string): string;
export function resolveCaptionFontWeight(fontId: string): number;
export function ensureCaptionFontLoaded(
  fontId: string,
  text?: string,
): Promise<CaptionFontDefinition>;
