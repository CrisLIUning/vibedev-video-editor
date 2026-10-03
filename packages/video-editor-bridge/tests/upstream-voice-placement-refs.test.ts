import { describe, expect, it } from 'vitest';

import appSource from '../../../vendor/ai-video-editor/src/App.jsx?raw';
import voiceGenerationSource from '../../../vendor/ai-video-editor/src/hooks/useVoiceGeneration.js?raw';

// Field report (2026-09-03): generating a voiceover with the local TTS engine
// threw "Cannot read properties of undefined (reading 'current')" and nothing
// further happened. useVoiceGeneration reads the editor's playhead and audio
// segments when it decides where to place the generated clips, but App.jsx
// called it with only a subset of the refs. Two of those reads used `?.` and
// degraded quietly; `d.currentTimeRef.current` did not, so it threw at
// placement and the generated audio was lost after the model had already run.
//
// Two independent guarantees, hence two tests: the hook must never throw on a
// ref it was not given, AND the caller must actually give it, or placement is
// silently wrong (everything lands at 0 instead of after the playhead).

/** Names the hook reads off its single `d` argument as refs. */
const PLACEMENT_REFS = ['currentTimeRef', 'audioSegmentsRef', 'generatedVoiceEndRef'] as const;

/** Source with comments removed — a comment naming the old bug is not the bug. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');
}

describe('useVoiceGeneration placement inputs', () => {
  it.each(PLACEMENT_REFS)('reads %s optionally, so a missing ref cannot throw', (ref) => {
    // A bare `d.<ref>.current` is the shape that threw.
    expect(code(voiceGenerationSource)).not.toMatch(new RegExp(`d\\.${ref}\\.current`));
    expect(voiceGenerationSource).toContain(`d.${ref}?.current`);
  });

  it('falls back to a usable value rather than passing undefined onward', () => {
    // getGeneratedVoiceAppendStart was being handed undefined for both
    // arguments, which is not a crash but is not a placement either.
    expect(voiceGenerationSource).toContain('Number(d.currentTimeRef?.current) || 0');
    expect(voiceGenerationSource).toContain('d.audioSegmentsRef?.current ?? d.audioSegments ?? []');
  });

  it('is called with every ref its placement step reads', () => {
    const call = /useVoiceGeneration\(\{([\s\S]*?)\}\);/.exec(appSource);
    expect(call, 'useVoiceGeneration call site not found in App.jsx').not.toBeNull();
    const passed = call![1];
    for (const ref of PLACEMENT_REFS) {
      expect(passed, `useVoiceGeneration must be passed ${ref}`).toContain(ref);
    }
    expect(passed, 'placement also reads d.audioSegments as a fallback').toContain('audioSegments');
  });
});
