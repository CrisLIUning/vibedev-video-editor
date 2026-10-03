import { describe, expect, it } from 'vitest';

import appSource from '../../../vendor/ai-video-editor/src/App.jsx?raw';
import catalogSource from '../../../vendor/ai-video-editor/src/hooks/useEditorCatalog.js?raw';
import teamMediaSource from '../../../vendor/ai-video-editor/src/lib/teamMedia.js?raw';
import panelsSource from '../../../vendor/ai-video-editor/src/components/panels.jsx?raw';

/**
 * What the asset library shows before anyone types.
 *
 * Upstream opens every tab on "nature" and, with no Pexels key, searches
 * Wikimedia Commons — so the first screen of the library in this product was
 * landscape photography from an encyclopaedia, for every project, in a tool
 * whose users are making Chinese short video. Nobody had chosen that; it was
 * the demo default nobody had changed.
 *
 * This pins the three parts of the fix in the vendored source, where an
 * upstream refresh has to look: the categories a tab opens on, the keyless
 * source for stills, and the presets reaching the panel.
 */
describe('what the library opens on', () => {
  it('opens on a category people here would actually ask for, not "nature"', () => {
    expect(catalogSource).toContain('export const LIBRARY_CATEGORIES');
    expect(catalogSource).not.toContain('image: "nature"');
    // The default is the first preset, so the opening screen and the first
    // chip can never drift apart.
    expect(catalogSource).toContain('image: LIBRARY_CATEGORIES.image[0]');
    expect(catalogSource).toContain('audio: LIBRARY_CATEGORIES.audio[0]');
  });

  it('takes stills from Openverse when there is no Pexels key', () => {
    // Commons is an encyclopaedia: cleanly licensed diagrams and monuments,
    // almost never what a cut needs. Openverse indexes the CC-licensed world
    // the audio tab already searches and needs no key either.
    expect(catalogSource).toContain('searchOpenverseImages');
    expect(catalogSource).toContain("license: 'cc0,by,pdm'".replace(/'/g, '"'));
    // The foreign source now sits inside the Promise.all that runs it beside
    // our own catalogue, so the slice starts there rather than at the old
    // single-source assignment.
    const start = catalogSource.indexOf('const results = await Promise.allSettled([');
    const dispatch = catalogSource.slice(start, catalogSource.indexOf('setLibraryStatus("ready")', start));
    expect(dispatch).toContain('searchOpenverseImages');
    // Video has no keyless source, so it still falls back rather than showing
    // an empty tab.
    expect(dispatch).toContain('searchCommons');
  });

  it('hands the presets to the panel that draws them', () => {
    expect(catalogSource).toContain('libraryCategories: LIBRARY_CATEGORIES[libraryType]');
    expect(appSource).toContain('libraryProvider, libraryCategories,');
    expect(panelsSource).toContain('libraryCategories = [],');
    expect(panelsSource).toContain('setLibraryQuery(category)');
  });
});

/**
 * The community catalogue in the asset library.
 *
 * This is the whole reason the library was worth touching: the upstream
 * sources are stock libraries for a Western market, and what a person here
 * reaches for is what people here have shared. Ours goes first; theirs stays,
 * because a young community shown alone is a nearly empty panel.
 */
describe('our own catalogue in the library', () => {
  it('queries the daemon, not a foreign API', () => {
    expect(catalogSource).toContain('/api/community/media');
  });

  it('runs alongside the foreign source rather than after it', () => {
    // Sequential would make our library wait behind a foreign API on every
    // keystroke, for results that are drawn above it.
    expect(catalogSource).toContain('await Promise.allSettled([');
    expect(catalogSource).toContain('searchCommunityMedia(libraryType, query');
  });

  it('puts our results first, nearest-to-the-work first', () => {
    // Team, then the community, then the foreign stock libraries. What a
    // colleague shared this morning beats a public catalogue, which beats a
    // stock photo of a mountain.
    expect(catalogSource).toContain('setBuiltInAssets([...team, ...community, ...external])');
  });

  it('cannot empty the panel when our catalogue is down', () => {
    // A failure returns nothing and the foreign sources still fill the panel.
    // Our being unreachable is not a reason for the library to be empty.
    const fn = catalogSource.slice(
      catalogSource.indexOf('async function searchCommunityMedia'),
      catalogSource.indexOf('const COMMUNITY_LICENSE_LABEL'),
    );
    expect(fn).toContain('if (!response.ok) return [];');
    expect(fn).toContain('return [];');
    // An abort still propagates — a cancelled keystroke is not a failure to
    // swallow, and swallowing it would race the next query.
    expect(fn).toContain("error?.name === \"AbortError\"");
  });

  it('does not filter our catalogue by the stock-search chips', () => {
    // The chips are presets aimed at a stock-photo search. Applied to a small
    // community library they filter it to nothing, which reads as "there is
    // nothing here" rather than "nothing matched that word".
    expect(catalogSource).toContain('query !== DEFAULT_QUERY[type]');
  });

  it('carries the licence with the asset', () => {
    // What the uploader claims about provenance is the whole basis on which
    // anyone may reuse it, so it travels rather than being dropped at the panel.
    expect(catalogSource).toContain('COMMUNITY_LICENSE_LABEL');
  });
});

/**
 * The team's shared media, the other half of "our own library".
 *
 * The community catalogue is what everyone published; this is what the people
 * you work with put in reach — for a film usually the more useful of the two,
 * because the footage a colleague generated this morning is not on a public
 * catalogue and never will be.
 */
describe('team media in the library', () => {
  it('reads the team from the same directory the rail does', () => {
    // Not a second idea of "current workspace": one wrong answer in two places
    // is how a panel ends up showing another team's library.
    expect(catalogSource).toContain('/api/workspace/directory');
    expect(catalogSource).toContain('activeWorkspaceId');
  });

  it('asks for nothing at all without a team', () => {
    // A personal workspace has no team library; issuing the request anyway
    // would spend a round trip per keystroke to be told so.
    expect(catalogSource).toContain('if (!workspaceId) return [];');
  });

  it('mints the read capability only when the asset is actually wanted', () => {
    // The capability lasts about a month. Minting one per card drawn would
    // hand out dozens of month-long tokens to render a grid nobody may click.
    expect(catalogSource).toContain('vibedev-team-media:');
    expect(teamMediaSource).toContain('resolveTeamMediaSrc');
    expect(teamMediaSource).toContain('/media/${encodeURIComponent(assetId)}/url');
  });

  it('cannot empty the panel when the team library is unreachable', () => {
    // Same rule as the community source: a failure returns nothing and the
    // other sources still fill the panel.
    const start = catalogSource.indexOf('async function searchTeamMedia');
    const body = catalogSource.slice(start, catalogSource.indexOf('// FORK: one community', start));
    expect(body).toContain('return [];');
    expect(body).toContain('AbortError');
  });
});
