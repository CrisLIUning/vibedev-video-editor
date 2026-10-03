// Whether a media element loading `src` should request it in CORS mode.
//
// The editor used to mark EVERY asset `<img crossOrigin="anonymous">` and set
// `image.crossOrigin = "anonymous"` on every analysis image. Inside VibeDev
// that breaks the load outright: the page origin is the packaged app's own
// `od://app`, and marking a request cross-origin is the only thing that makes
// the browser treat these same-origin asset URLs as a CORS request. Measured in
// a running packaged app (field report 2026-09-03), same file, same URL:
//
//   <img src=…>                          → loaded, 1440x1000
//   <img src=… crossOrigin="anonymous">  → failed
//   drawImage + getImageData afterwards  → canvas NOT tainted
//
// So the attribute bought nothing and cost every project-file and host-asset
// thumbnail in the media panel, the timeline and the preview stage.
//
// It is not simply removable, though: a genuinely remote asset DOES need CORS
// mode, or reading pixels back off the canvas throws. So ask per source.

/** The page's own origin, or "" outside a document (worker, SSR, test). */
function pageOrigin() {
  try {
    return typeof location === "undefined" ? "" : String(location.origin || "");
  } catch {
    return "";
  }
}

/**
 * `"anonymous"` when `src` is a remote http(s) URL from another origin, and
 * `undefined` otherwise.
 *
 * `undefined` is the deliberate return for the "no" case: React omits the
 * attribute entirely for `undefined`, which is exactly the plain same-origin
 * load that works. Relative paths, `blob:`, `data:`, and anything on this
 * origin all take that path — none of them taints a canvas.
 */
export function mediaCrossOrigin(src) {
  if (typeof src !== "string" || src === "") return undefined;
  // Relative — same origin by construction.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src)) return undefined;
  // Same-origin by definition; a canvas is never tainted by these.
  if (src.startsWith("blob:") || src.startsWith("data:")) return undefined;
  let parsed;
  try {
    parsed = new URL(src, pageOrigin() || undefined);
  } catch {
    return undefined;
  }
  // Only http(s) can be a CORS request at all. A custom scheme cannot, and
  // asking for one there is what broke the packaged app.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  const origin = pageOrigin();
  if (origin && parsed.origin === origin) return undefined;
  return "anonymous";
}

/**
 * Apply the same decision to an element created in code (`new Image()`,
 * `document.createElement("video")`). Set BEFORE assigning `src`, as the
 * platform requires.
 */
export function applyMediaCrossOrigin(element, src) {
  const value = mediaCrossOrigin(src);
  if (value) element.crossOrigin = value;
  else element.removeAttribute?.("crossorigin");
  return element;
}
