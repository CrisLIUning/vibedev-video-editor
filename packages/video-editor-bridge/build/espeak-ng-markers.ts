/**
 * eSpeak NG is GPL-3.0-or-later and must not ship in VibeDev's editor builds.
 * The editor reaches it through two speech front ends that
 * `vendor/ai-video-editor/src/config/vibedevFeatures.js` switches off:
 * kokoro-js, whose `phonemizer` embeds eSpeak NG compiled to WASM, and
 * @diffusionstudio/vits-web, whose piper-phonemize loader mounts eSpeak NG's
 * data. With a flag off its import is unreachable and the bundler drops it;
 * this scan fails a build if anything brings it back. A flag turned on on
 * purpose turns its markers off, so the switch stays a one-line change.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { ESPEAK_PIPER_VOICES_ENABLED, KOKORO_VOICES_ENABLED } from '../../../vendor/ai-video-editor/src/config/vibedevFeatures.js';

export interface EspeakNgFlags {
  kokoroVoices: boolean;
  espeakPiperVoices: boolean;
}

/** The flags as the editor source sets them. */
export const EDITOR_ESPEAK_NG_FLAGS: EspeakNgFlags = {
  kokoroVoices: KOKORO_VOICES_ENABLED,
  espeakPiperVoices: ESPEAK_PIPER_VOICES_ENABLED,
};

export interface EspeakNgMarkers {
  /** Text that only eSpeak NG, or the packages that carry it, put into a bundle. */
  content: string[];
  /** File names Vite gives those packages. */
  names: RegExp[];
}

/** What the bundle must not contain while the given front ends are off. */
export function espeakNgMarkers(flags: EspeakNgFlags): EspeakNgMarkers {
  const content: string[] = [];
  const names: RegExp[] = [];
  if (!flags.kokoroVoices) {
    // eSpeak NG's API in phonemizer's WASM glue, and the Kokoro loader that pulls it in.
    content.push('espeak_EVENT_TYPE', 'kokoro-js', 'KokoroTTS');
    names.push(/(?:^|\/)(?:kokoro|phonemizer)-[^/]*$/i);
  }
  if (!flags.espeakPiperVoices) {
    // vits-web's eSpeak NG-based phonemizer.
    content.push('piper_phonemize');
    names.push(/(?:^|\/)vits-web-[^/]*$/i);
  }
  if (!flags.kokoroVoices && !flags.espeakPiperVoices) {
    // eSpeak NG's data package, which both phonemizer and piper-phonemize mount.
    content.push('espeak-ng-data');
    // Not preceded by a letter: transformers.js has a "wespeaker" model.
    names.push(/(?:^|[^a-z])espeak/i);
  }
  return { content, names };
}

export interface EspeakNgFinding {
  /** Path relative to the scanned root, with forward slashes. */
  file: string;
  /** The marker found, or `file name` when the name itself matched. */
  marker: string;
}

async function listFiles(root: string, relative = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) found.push(...await listFiles(root, child));
    else if (entry.isFile()) found.push(child);
  }
  return found;
}

/**
 * Every file under `root` whose name or bytes carry a marker. Files are
 * searched as bytes, so a WASM module or a data file is covered too.
 */
export async function findEspeakNgMarkers(root: string, flags = EDITOR_ESPEAK_NG_FLAGS): Promise<EspeakNgFinding[]> {
  const markers = espeakNgMarkers(flags);
  const findings: EspeakNgFinding[] = [];
  for (const file of (await listFiles(root)).sort()) {
    if (markers.names.some(name => name.test(file))) findings.push({ file, marker: 'file name' });
    if (markers.content.length === 0) continue;
    const bytes = await readFile(path.join(root, file));
    for (const marker of markers.content) {
      if (bytes.includes(marker)) findings.push({ file, marker });
    }
  }
  return findings;
}

/** Throws when `root` holds any marker; the message names where. */
export async function assertNoEspeakNg(root: string, label: string, flags = EDITOR_ESPEAK_NG_FLAGS): Promise<void> {
  const findings = await findEspeakNgMarkers(root, flags);
  if (findings.length === 0) return;
  const listed = findings.slice(0, 8).map(finding => `${finding.file} (${finding.marker})`).join(', ');
  throw new Error(
    `${label} contains eSpeak NG (GPL-3.0-or-later): ${listed}${findings.length > 8 ? ', …' : ''}. `
      + 'The Kokoro and eSpeak Piper voices are off in vendor/ai-video-editor/src/config/vibedevFeatures.js; '
      + 'keep their imports behind those flags.',
  );
}
