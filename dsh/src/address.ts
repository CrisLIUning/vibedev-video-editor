/**
 * Where the editor's daemon calls go under DeepSeek Harness.
 *
 * The editor and the documents it saves speak Studio's daemon paths
 * (`/api/projects/<id>/raw/...`, `/api/canvas/timelines/...`). Under DSH the
 * dsh-film plugin answers those behind one route of the Host's API channel,
 * which matches paths exactly and carries only GET, HEAD and POST:
 *
 *   GET|HEAD /api/dsh-film/studio?cwd=<workspace>&path=<daemon path + query>
 *   POST     /api/dsh-film/studio-write?cwd=<workspace>&path=<...>&method=PUT|POST|...
 *
 * So the page re-addresses every same-origin daemon URL it uses — fetch
 * calls, event streams and the `src` of media elements, which no fetch
 * wrapper sees — and leaves everything else alone. Saved cuts keep Studio's
 * URLs, so a `film/` folder stays readable by Studio.
 */

const query = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);

/** The workspace this page edits (`?cwd=`). */
export const workspace: string = query.get('cwd')?.trim() ?? '';
/** The film project's id (`?project=`), which is also its board's id. */
export const projectId: string = query.get('project')?.trim() || 'film';

/** The plugin's API root: two levels above this page (`/api/dsh-film/apps/editor/`). */
export function pluginRoot(base: string = location.href): URL {
  return new URL('../../', new URL('.', base));
}

/** Whether a URL is a daemon URL the plugin answers (and not one of the plugin's own). */
export function isDaemonUrl(url: URL, origin: string = location.origin, root: URL = pluginRoot()): boolean {
  return url.origin === origin && url.pathname.startsWith('/api/') && !url.pathname.startsWith(root.pathname);
}

/**
 * The address to request for a daemon URL, or the URL as it was when it is
 * not one.
 * @param value - an absolute or page-relative URL.
 * @param method - the daemon method.
 */
export function toHostUrl(value: string | URL, method = 'GET', base: string = location.href): string {
  const raw = typeof value === 'string' ? value : value.href;
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return raw;
  }
  const root = pluginRoot(base);
  if (!isDaemonUrl(url, new URL(base).origin, root)) return raw;
  const upper = method.toUpperCase();
  // Reads and writes are separate routes: the Host streams request bodies
  // only on routes that carry no GET.
  const read = upper === 'GET' || upper === 'HEAD';
  const target = new URL(read ? 'studio' : 'studio-write', root);
  if (workspace !== '') target.searchParams.set('cwd', workspace);
  target.searchParams.set('path', url.pathname + url.search);
  if (!read) target.searchParams.set('method', upper);
  return target.pathname + target.search;
}

/** Elements whose URL attributes load from the daemon. */
const URL_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  IMG: ['src'],
  VIDEO: ['src', 'poster'],
  AUDIO: ['src'],
  SOURCE: ['src'],
  TRACK: ['src'],
  A: ['href'],
};

function patchUrlProperty(prototype: object, property: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
  if (!descriptor?.set || !descriptor.get) return;
  const { get, set } = descriptor;
  Object.defineProperty(prototype, property, {
    configurable: true,
    enumerable: descriptor.enumerable ?? true,
    get() { return get.call(this); },
    set(value: unknown) { set.call(this, typeof value === 'string' ? toHostUrl(value) : value); },
  });
}

let installed = false;

/** Re-address the page's daemon traffic to the plugin. */
export function installHostAdapter(): void {
  if (installed) return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : undefined;
    const address = request ? request.url : input instanceof URL ? input.href : String(input);
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const target = toHostUrl(address, method);
    if (target === address) return nativeFetch(input, init);
    const transport = method === 'GET' || method === 'HEAD' ? method : 'POST';
    if (request) {
      return nativeFetch(new Request(target, {
        method: transport,
        headers: request.headers,
        body: transport === 'POST' ? request.body : null,
        signal: request.signal,
        credentials: 'same-origin',
        ...(transport === 'POST' && request.body ? { duplex: 'half' } : {}),
      } as RequestInit), init === undefined ? undefined : { ...init, method: transport });
    }
    return nativeFetch(target, { ...init, method: transport, credentials: init?.credentials ?? 'same-origin' });
  };

  const NativeEventSource = window.EventSource;
  if (NativeEventSource) {
    window.EventSource = class HostEventSource extends NativeEventSource {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(toHostUrl(url), init);
      }
    };
  }

  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (this: Element, name: string, value: string): void {
    const rewrites = URL_ATTRIBUTES[this.tagName]?.includes(name.toLowerCase()) === true;
    setAttribute.call(this, name, rewrites ? toHostUrl(value) : value);
  };
  patchUrlProperty(HTMLImageElement.prototype, 'src');
  patchUrlProperty(HTMLMediaElement.prototype, 'src');
  patchUrlProperty(HTMLVideoElement.prototype, 'poster');
  patchUrlProperty(HTMLSourceElement.prototype, 'src');
  patchUrlProperty(HTMLTrackElement.prototype, 'src');
  patchUrlProperty(HTMLAnchorElement.prototype, 'href');
}
