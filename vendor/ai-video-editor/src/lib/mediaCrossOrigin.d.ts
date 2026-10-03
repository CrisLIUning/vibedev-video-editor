/**
 * `"anonymous"` when `src` must be fetched in CORS mode for its pixels to be
 * readable, `undefined` when it must not be. Same-origin, blob:, data:, and
 * custom-scheme sources decide "no": marking them cross-origin makes the
 * browser send an Origin the daemon rejects, and buys nothing, because such a
 * source never taints a canvas.
 */
export function mediaCrossOrigin(src: string): 'anonymous' | undefined;

/** Apply that decision to an element, removing the attribute when it is "no". */
export function applyMediaCrossOrigin<T extends HTMLElement>(element: T, src: string): T;
