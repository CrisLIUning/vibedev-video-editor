// FORK: types for the parts of ttsText.js the bridge tests use.

/** A script the selected voice cannot read; `code` is the i18n key the editor shows. */
export class TtsInputError extends Error {
  constructor(code: string);
  code: string;
}

export function splitTextAtSentenceEnd(rawText: string): string[];

export function prepareTextForVoice(
  rawText: string,
  voice: { engine?: string; language?: string } | null | undefined,
): { text: string; warningKey: string };
