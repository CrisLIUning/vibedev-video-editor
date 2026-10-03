import { describe, expect, it } from 'vitest';

import topbarSource from '../../../vendor/ai-video-editor/src/components/Topbar.jsx?raw';

describe('embedded editor topbar', () => {
  it('does not render upstream community links inside VibeDev', () => {
    expect(topbarSource).not.toContain('topbar-community-links');
    expect(topbarSource).not.toContain('discord.gg');
    expect(topbarSource).not.toContain('github.com/MartinDelophy');
  });
});
