import { describe, expect, it } from 'vitest';

import {
  effectiveVoiceName,
  voiceClipTitle,
  voiceScriptExcerpt,
} from '../../../vendor/ai-video-editor/src/lib/voiceGenerationCapability.js';
import voiceGenerationSource from '../../../vendor/ai-video-editor/src/hooks/useVoiceGeneration.js?raw';

// Field report (2026-09-03): after cloning a voice, the generated clip was
// called "晴岚 · 1/1". Two things were wrong at once. The counter says nothing —
// every clip from one voice looked identical in the media panel, and none of
// them said which line it was. And 晴岚 is the built-in engine voice: cloning
// selects a PROFILE while the engine voice stays the same, so the label named a
// voice the person had not chosen.

describe('voiceScriptExcerpt', () => {
  it('quotes the spoken line', () => {
    expect(voiceScriptExcerpt('你好世界')).toBe('你好世界');
  });

  it('collapses the whitespace a multi-line script carries', () => {
    expect(voiceScriptExcerpt('  第一句\n\n  第二句  ')).toBe('第一句 第二句');
  });

  it('truncates a long line rather than letting it run off the card', () => {
    const excerpt = voiceScriptExcerpt('一'.repeat(60));
    expect(excerpt).toHaveLength(25);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('is total: nothing to quote answers ""', () => {
    expect(voiceScriptExcerpt('')).toBe('');
    expect(voiceScriptExcerpt('   ')).toBe('');
    expect(voiceScriptExcerpt(undefined)).toBe('');
  });
});

describe('effectiveVoiceName', () => {
  it('names the cloned profile, not the engine voice underneath it', () => {
    expect(effectiveVoiceName('晴岚', '我的声音')).toBe('我的声音');
  });

  it('falls back to the engine voice when nothing was cloned', () => {
    expect(effectiveVoiceName('晴岚', '')).toBe('晴岚');
    expect(effectiveVoiceName('晴岚', undefined)).toBe('晴岚');
  });

  it('never answers empty', () => {
    expect(effectiveVoiceName('', '')).toBe('配音');
  });
});

describe('voiceClipTitle', () => {
  it('leads with the line, so two clips of one voice are told apart', () => {
    expect(voiceClipTitle('今天天气不错', '我的声音', 0, 2)).toBe('今天天气不错 · 我的声音');
    expect(voiceClipTitle('明天有雨', '我的声音', 1, 2)).toBe('明天有雨 · 我的声音');
  });

  it('keeps the counter only when there is no line to quote', () => {
    expect(voiceClipTitle('', '晴岚', 0, 1)).toBe('晴岚 · 1/1');
    expect(voiceClipTitle('   ', '晴岚', 1, 3)).toBe('晴岚 · 2/3');
  });
});

describe('the TTS flow supplies what the naming needs', () => {
  it('records the spoken line on every generated item', () => {
    expect(voiceGenerationSource).toContain('generatedItems.push({ blob, script: sentence })');
  });

  it('passes the cloned profile through to the capability', () => {
    expect(voiceGenerationSource).toContain('voiceProfileName: d.selectedVoiceProfile?.name');
  });
});
