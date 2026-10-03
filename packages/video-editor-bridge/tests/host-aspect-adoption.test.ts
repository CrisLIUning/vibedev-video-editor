import { describe, expect, it } from 'vitest';

import { HOST_PROJECT_ASPECTS, shouldAdoptHostAspect } from '../src/index.js';

const ALLOWED = ['9:16', '16:9', '1:1', '4:5'] as const;

/**
 * Reported from the app: the ratio control could not be used. Every pick
 * snapped back to the production's ratio.
 *
 * The mechanism is a loop, not a bad value. Changing the ratio re-runs the
 * effect that connects the host bridge; `connect` replays the host metadata;
 * a rule of "adopt whenever the host differs from me" then reverses the pick.
 * These specs pin the rule that breaks the loop: the host wins when the HOST
 * changes, and only then.
 */
describe('adopting the host ratio', () => {
  it('takes the host ratio the first time it arrives', () => {
    expect(shouldAdoptHostAspect({
      hostAspect: '9:16', lastAdopted: null, current: '16:9', allowed: ALLOWED,
    })).toBe(true);
  });

  it('does not re-assert the same host ratio after the user picks another', () => {
    // The reported bug, as one call: the host has published 16:9 already, the
    // user has since chosen 9:16, and a reconnect replays 16:9.
    expect(shouldAdoptHostAspect({
      hostAspect: '16:9', lastAdopted: '16:9', current: '9:16', allowed: ALLOWED,
    })).toBe(false);
  });

  it('takes a NEW host ratio even after an earlier adoption', () => {
    // Editing the aspect in the production brief still has to reach the editor.
    expect(shouldAdoptHostAspect({
      hostAspect: '1:1', lastAdopted: '16:9', current: '9:16', allowed: ALLOWED,
    })).toBe(true);
  });

  it('stays put when the host agrees with the editor', () => {
    expect(shouldAdoptHostAspect({
      hostAspect: '9:16', lastAdopted: null, current: '9:16', allowed: ALLOWED,
    })).toBe(false);
  });

  it('ignores a ratio this editor cannot render, and an absent one', () => {
    expect(shouldAdoptHostAspect({
      hostAspect: '21:9', lastAdopted: null, current: '16:9', allowed: ALLOWED,
    })).toBe(false);
    expect(shouldAdoptHostAspect({
      hostAspect: undefined, lastAdopted: null, current: '16:9', allowed: ALLOWED,
    })).toBe(false);
  });
});

describe('the ratios a host may publish', () => {
  it('include the cinema frames 剪二期 added, and the editor adopts them like any other', () => {
    expect(HOST_PROJECT_ASPECTS).toEqual(['9:16', '16:9', '1:1', '4:5', '21:9', '2.39:1']);
    expect(shouldAdoptHostAspect({
      hostAspect: '2.39:1', lastAdopted: null, current: '16:9', allowed: HOST_PROJECT_ASPECTS,
    })).toBe(true);
  });
});
