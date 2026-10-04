import { describe, expect, it } from 'vitest';
import { createEmptyTimelineArchive, inspectVideoEditorDocument, isEmptyTimeline, type JsonObject } from '../src/index.js';

const withClip = (key: string, clip: JsonObject): JsonObject => {
  const archive = createEmptyTimelineArchive('16:9');
  return { ...archive, project: { ...(archive.project as JsonObject), [key]: [clip] } };
};

describe('isEmptyTimeline', () => {
  it('calls no cut, a fresh archive and an archive whose tracks were all cleared empty', () => {
    expect(isEmptyTimeline(null)).toBe(true);
    expect(isEmptyTimeline(undefined)).toBe(true);
    expect(isEmptyTimeline(createEmptyTimelineArchive())).toBe(true);
    expect(isEmptyTimeline({ format: 'timeline-studio-archive', version: 3, project: { ratioId: '9:16' } })).toBe(true);
  });

  it('calls a cut with a clip on any of the engine\'s tracks not empty, captions and stickers included', () => {
    const clips: Array<[string, JsonObject]> = [
      ['visualSegments', { id: 'v1', type: 'video', duration: 4 }],
      ['visualOverlaySegments', { id: 'o1', start: 0, duration: 2 }],
      ['audioSegments', { id: 'a1', start: 0, duration: 2 }],
      ['musicSegments', { id: 'm1', start: 0, duration: 9 }],
      ['captionSegments', { id: 'c1', start: 0, end: 2, text: 'rain' }],
      ['stickerSegments', { id: 's1', start: 0, duration: 2 }],
    ];
    for (const [key, clip] of clips) {
      const document = withClip(key, clip);
      // The same clip the engine counts on one of its tracks.
      const counted = Object.values(inspectVideoEditorDocument(document).tracks).reduce<number>((total, count) => total + Number(count), 0);
      expect(counted, key).toBe(1);
      expect(isEmptyTimeline(document), key).toBe(false);
    }
  });

  it('does not call a document that is not an archive empty: what it holds is unknown', () => {
    expect(isEmptyTimeline({})).toBe(false);
    expect(isEmptyTimeline({ format: 'timeline-studio-archive', version: 2, project: {} })).toBe(false);
    expect(isEmptyTimeline('cut')).toBe(false);
  });
});
