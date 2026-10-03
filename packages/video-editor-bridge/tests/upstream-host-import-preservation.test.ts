// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  holdsTextEntry,
  isHostRefresh,
  selectedAudioSegmentAfterImport,
} from '../../../vendor/ai-video-editor/src/lib/hostImportPreservation.js';
import projectFilesSource from '../../../vendor/ai-video-editor/src/hooks/useProjectFiles.js?raw';

// Field report (2026-09-03): the user was typing in the editor, hit Backspace to
// fix a typo, and a clip on the timeline was deleted instead. Then the deleted
// clip came back on its own a moment later.
//
// The trigger is the host re-importing the whole project, which it does whenever
// its document changes — and its document changes for reasons the person did not
// cause (the daemon commits an `asset.place_version` for every generated asset).
// That refresh replaced the text in the box they were typing in, and selected an
// audio clip they had never selected. A selected clip is exactly what Backspace
// acts on, so the next keystroke deleted it.
//
// Opening a project file is a different act and keeps its old behaviour: the
// person asked for a fresh start.

const HOST = { hostDocument: true } as const;
const OPENED = { hostDocument: false } as const;

const SEGMENTS = [{ id: 'seg-a' }, { id: 'seg-b' }];

function textField(): Element {
  const input = document.createElement('input');
  document.body.appendChild(input);
  return input;
}

describe('isHostRefresh', () => {
  it('separates a host refresh from the person opening a project', () => {
    expect(isHostRefresh(HOST)).toBe(true);
    expect(isHostRefresh(OPENED)).toBe(false);
    expect(isHostRefresh(undefined)).toBe(false);
    expect(isHostRefresh({})).toBe(false);
  });
});

describe('selectedAudioSegmentAfterImport', () => {
  it('never invents a selection on a host refresh — that is what Delete acts on', () => {
    expect(selectedAudioSegmentAfterImport(HOST, '', SEGMENTS)).toBe('');
  });

  it('keeps the clip the person had selected', () => {
    expect(selectedAudioSegmentAfterImport(HOST, 'seg-b', SEGMENTS)).toBe('seg-b');
  });

  it('clears a selection whose clip the refresh removed, rather than sliding to another', () => {
    expect(selectedAudioSegmentAfterImport(HOST, 'seg-gone', SEGMENTS)).toBe('');
  });

  it('still selects the first clip when the person opens a project', () => {
    expect(selectedAudioSegmentAfterImport(OPENED, '', SEGMENTS)).toBe('seg-a');
    expect(selectedAudioSegmentAfterImport(OPENED, 'seg-b', SEGMENTS)).toBe('seg-a');
  });

  it('is total: no segments means no selection, on either path', () => {
    expect(selectedAudioSegmentAfterImport(HOST, 'seg-a', [])).toBe('');
    expect(selectedAudioSegmentAfterImport(OPENED, 'seg-a', [])).toBe('');
    expect(selectedAudioSegmentAfterImport(OPENED, '', undefined)).toBe('');
  });
});

describe('holdsTextEntry', () => {
  it('declines to replace text while a caret sits in a field, on a host refresh', () => {
    expect(holdsTextEntry(HOST, textField())).toBe(true);
  });

  it('lets a host refresh through when nobody is typing', () => {
    expect(holdsTextEntry(HOST, document.body)).toBe(false);
    expect(holdsTextEntry(HOST, null)).toBe(false);
  });

  it('never blocks the person opening a project — they asked for that content', () => {
    expect(holdsTextEntry(OPENED, textField())).toBe(false);
  });
});

describe('useProjectFiles applies both rules', () => {
  it('routes the audio selection through the helper instead of picking the first clip', () => {
    expect(projectFilesSource).toContain('selectedAudioSegmentAfterImport(');
    // The shape that force-selected a clip the person never chose.
    expect(projectFilesSource).not.toContain('setSelectedAudioSegmentId(restoredAudioSegments[0]');
  });

  it('guards the script field before replacing it', () => {
    expect(projectFilesSource).toContain('holdsTextEntry(');
    expect(projectFilesSource).toMatch(/&& !typing\) deps\.setScript\(/);
  });
});
