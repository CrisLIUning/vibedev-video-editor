import { useEffect, useReducer, useRef } from "react";

import { extractVideoTrackFrames, getVisualDimensions, loadVideo } from "../lib/media.js";
import { mergeVisualBackfill, needsVisualBackfill, visualBackfillSourceKey } from "../lib/hostVisualBackfill.js";

/**
 * Measures the video clips an agent or a capability placed, which arrive as
 * command metadata with no dimensions and no frame strip. See
 * `lib/hostVisualBackfill.js` for why they arrive that way and what it costs.
 *
 * Source measurements outlive ordinary clip edits. Only an unmount cancels
 * decoding; every write checks the current source and fills missing fields.
 * A bounded cache restores frame strips removed by document imports.
 */
export function useHostVisualBackfill({ visualSegments, setVisualSegments }) {
  const runtime = useRef(null);
  const [revision, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const state = { active: true, jobs: new Map(), cache: new Map(), failed: new Set() };
    runtime.current = state;
    return () => {
      state.active = false;
      for (const job of state.jobs.values()) job.abort();
      state.cache.clear();
    };
  }, []);

  useEffect(() => {
    const state = runtime.current;
    if (!state?.active) return;
    const present = new Set(visualSegments.map(visualBackfillSourceKey));
    for (const key of state.failed) if (!present.has(key)) state.failed.delete(key);
    const targets = new Map(visualSegments
      .filter((clip) => !clip.preparing && needsVisualBackfill(clip))
      .map((clip) => [visualBackfillSourceKey(clip), clip]));

    const apply = (key, measured) => {
      if (!state.active) return;
      setVisualSegments((segments) => {
        if (!state.active) return segments;
        let changed = false;
        const next = segments.map((clip) => {
          if (clip.preparing || visualBackfillSourceKey(clip) !== key) return clip;
          const merged = mergeVisualBackfill(clip, measured);
          if (merged !== clip) changed = true;
          return merged;
        });
        return changed ? next : segments;
      });
    };
    for (const [key, clip] of targets) {
      if (state.cache.has(key)) {
        apply(key, state.cache.get(key));
        continue;
      }
      if (state.jobs.has(key) || state.failed.has(key) || state.jobs.size >= 2) continue;
      const controller = new AbortController();
      state.jobs.set(key, controller);
      void (async () => {
        let video;
        try {
          video = await loadVideo(clip.src, { signal: controller.signal, timeoutMs: 20000 });
          if (!state.active) return;
          const measured = getVisualDimensions(video);
          // Sample the whole source; authored trims and speed map into it.
          const duration = Number.isFinite(video.duration) && video.duration > 0
            ? video.duration : Math.max(0, (Number(clip.sourceStart) || 0) + Number(clip.sourceDuration || clip.duration));
          video.removeAttribute("src");
          video.load();
          video = null;
          const trackFrames = await extractVideoTrackFrames(clip.src, { ...measured, duration, signal: controller.signal });
          if (!state.active) return;
          const result = { ...measured, trackFrames, trackFrameDuration: duration };
          apply(key, result);
          if (trackFrames.length) {
            state.cache.set(key, result);
            if (state.cache.size > 32) state.cache.delete(state.cache.keys().next().value);
          } else state.failed.add(key);
        } catch (error) {
          if (state.active) {
            state.failed.add(key);
            console.warn("Video frame strip could not be read; reopening or re-adding the media retries it", error);
          }
        } finally {
          video?.removeAttribute("src");
          video?.load();
          state.jobs.delete(key);
          if (state.active) refresh();
        }
      })();
    }
  }, [visualSegments, setVisualSegments, revision]);
}
