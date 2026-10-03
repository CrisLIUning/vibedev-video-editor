export const MODEL_SOURCE_PREFERENCE_KEY = "timeline-studio-model-source";
export const MODEL_SCOPE_OWNER = "martindelophy";

const UI_LANGUAGE_STORAGE_KEY = "ai-voiceover-ui-language";
const VALID_PREFERENCES = new Set(["auto", "huggingface", "modelscope"]);

let runtimeModelSource = "";

export function resolveHostModelFile(request, fileKeys) {
  const rawUrl = typeof request === "string"
    ? request
    : request && typeof request.url === "string"
      ? request.url
      : String(request || "");
  const url = rawUrl.replaceAll("\\", "/").split("?", 1)[0];
  return Object.keys(fileKeys)
    .sort((left, right) => right.length - left.length)
    .find((candidate) => url.endsWith(candidate));
}

function readLocalStorage(key) {
  try {
    return globalThis.localStorage?.getItem(key) || "";
  } catch {
    return "";
  }
}

export function getModelSourcePreference(language = "") {
  const storedPreference = readLocalStorage(MODEL_SOURCE_PREFERENCE_KEY);
  if (VALID_PREFERENCES.has(storedPreference) && storedPreference !== "auto") {
    return storedPreference;
  }
  const activeLanguage = language || readLocalStorage(UI_LANGUAGE_STORAGE_KEY)
    || globalThis.navigator?.language || "";
  return String(activeLanguage).toLowerCase().startsWith("zh") ? "modelscope" : "huggingface";
}

export function orderModelSourceUrls(huggingFaceUrl, modelScopeUrl, preference = getModelSourcePreference()) {
  const ordered = preference === "modelscope"
    ? [modelScopeUrl, huggingFaceUrl]
    : [huggingFaceUrl, modelScopeUrl];
  return [...new Set(ordered.filter(Boolean))];
}

function modelSourceFromUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === "huggingface.co" || hostname.endsWith(".huggingface.co")) return "huggingface";
    if (hostname === "modelscope.cn" || hostname.endsWith(".modelscope.cn")) return "modelscope";
  } catch {
    // Non-URL candidates retain their caller-provided order.
  }
  return "";
}

function prioritizeSource(urls, source) {
  if (!source) return urls;
  return [...urls].sort((left, right) => (
    Number(modelSourceFromUrl(right) === source) - Number(modelSourceFromUrl(left) === source)
  ));
}

export async function orderModelUrlsForNetwork(urls) {
  const candidates = [...new Set((urls || []).filter(Boolean))];
  if (runtimeModelSource) return prioritizeSource(candidates, runtimeModelSource);
  // Preserve the locale/user-selected source order on the first request.
  // The first successful fetch becomes the session route; failures clear it
  // so the caller can immediately fall back to the other provider.
  return candidates;
}

export function mirroredModelFileUrls({
  repository,
  revision,
  huggingFaceRevision = revision,
  modelScopeRevision = revision,
  path,
  preference,
  modelScopeOwner = MODEL_SCOPE_OWNER,
}) {
  const suffix = path ? `/${String(path).replace(/^\/+/, "")}` : "";
  const resolvedPreference = preference === "huggingface" || preference === "modelscope"
    ? preference
    : getModelSourcePreference(preference);
  return orderModelSourceUrls(
    `https://huggingface.co/haixin/${repository}/resolve/${huggingFaceRevision}${suffix}`,
    `https://www.modelscope.cn/models/${modelScopeOwner}/${repository}/resolve/${modelScopeRevision}${suffix}`,
    resolvedPreference,
  );
}

export async function loadFromMirroredRepository(transformersEnv, {
  repository,
  modelPath,
  revision,
  huggingFaceRevision = revision,
  modelScopeRevision = revision,
  preference,
  modelScopeOwner = MODEL_SCOPE_OWNER,
}, loader) {
  const cleanModelPath = String(modelPath || "").replace(/^\/+|\/+$/g, "");
  const configPath = `${cleanModelPath}/config.json`;
  const configUrls = mirroredModelFileUrls({
    repository,
    huggingFaceRevision,
    modelScopeRevision,
    path: configPath,
    preference,
    modelScopeOwner,
  });
  const candidates = await orderModelUrlsForNetwork(configUrls);
  const failures = [];
  for (const configUrl of candidates) {
    const source = modelSourceFromUrl(configUrl);
    const remoteHost = configUrl.slice(0, -configPath.length);
    transformersEnv.remoteHost = remoteHost;
    transformersEnv.remotePathTemplate = "{model}/";
    try {
      const result = await loader(cleanModelPath, remoteHost);
      runtimeModelSource = source || runtimeModelSource;
      return result;
    } catch (error) {
      failures.push(`${new URL(configUrl).hostname}: ${error?.message || String(error)}`);
      if (source === runtimeModelSource) runtimeModelSource = "";
    }
  }
  throw new Error(`MODEL_MIRRORS_UNAVAILABLE: ${failures.join("; ")}`);
}

export function mirroredModelBaseUrls(options) {
  return mirroredModelFileUrls(options).map((url) => `${url.replace(/\/+$/, "")}/`);
}

export function hubModelFileUrls({
  repository,
  revision = "main",
  path,
  preference,
}) {
  const suffix = path ? `/${String(path).replace(/^\/+/, "")}` : "";
  const resolvedPreference = preference === "huggingface" || preference === "modelscope"
    ? preference
    : getModelSourcePreference(preference);
  return orderModelSourceUrls(
    `https://huggingface.co/${repository}/resolve/${revision}${suffix}`,
    `https://www.modelscope.cn/models/${repository}/resolve/${revision}${suffix}`,
    resolvedPreference,
  );
}

export function hubModelBaseUrls(options) {
  return hubModelFileUrls(options).map((url) => `${url.replace(/\/+$/, "")}/`);
}

export function modelHubRemoteHosts(preference) {
  const resolvedPreference = preference === "huggingface" || preference === "modelscope"
    ? preference
    : getModelSourcePreference(preference);
  return orderModelSourceUrls(
    "https://huggingface.co/",
    "https://www.modelscope.cn/models/",
    resolvedPreference,
  );
}

export async function loadFromModelHubs(transformersEnv, loader, preference) {
  const candidates = await orderModelUrlsForNetwork(modelHubRemoteHosts(preference));
  const failures = [];
  for (const remoteHost of candidates) {
    transformersEnv.remoteHost = remoteHost;
    transformersEnv.remotePathTemplate = "{model}/resolve/{revision}/";
    try {
      const result = await loader(remoteHost);
      runtimeModelSource = modelSourceFromUrl(remoteHost) || runtimeModelSource;
      return result;
    } catch (error) {
      failures.push(`${new URL(remoteHost).hostname}: ${error?.message || String(error)}`);
      if (modelSourceFromUrl(remoteHost) === runtimeModelSource) runtimeModelSource = "";
    }
  }
  throw new Error(`MODEL_MIRRORS_UNAVAILABLE: ${failures.join("; ")}`);
}

export function isModelDownloadError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /MODEL_MIRRORS_UNAVAILABLE|failed to fetch|fetch failed|networkerror|load failed/i.test(message);
}

export async function fetchFirstAvailableModel(urls, init) {
  const failures = [];
  const candidates = await orderModelUrlsForNetwork(urls);
  for (const url of candidates) {
    try {
      const response = await fetch(url, init);
      if (response.ok) {
        runtimeModelSource = modelSourceFromUrl(url) || runtimeModelSource;
        return { response, url };
      }
      failures.push(`${new URL(url).hostname}: HTTP ${response.status}`);
    } catch (error) {
      failures.push(`${new URL(url).hostname}: ${error?.message || String(error)}`);
    }
    if (modelSourceFromUrl(url) === runtimeModelSource) runtimeModelSource = "";
  }
  throw new Error(`MODEL_MIRRORS_UNAVAILABLE: ${failures.join("; ")}`);
}

export function __resetModelSourceRoutingForTests() {
  runtimeModelSource = "";
}
