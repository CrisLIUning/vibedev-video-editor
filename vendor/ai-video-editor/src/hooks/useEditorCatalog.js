import { useEffect, useMemo, useState } from "react";
import { VOICES } from "../config/editor.js";
import { clearRemoteAssetCache, getRemoteAssetBlob } from "../lib/remoteAssetCache.js";
import { VECTOR_ASSETS } from "../lib/vectorAssets.js";

// FORK: what the library shows before anyone types. Upstream opens on
// "nature", which is a stock-photo demo, not a starting point for the work
// people do here — the first screen of the asset library was landscape
// photography for every project. These are the categories a short film or a
// short video actually reaches for, and the first one is what opens.
export const LIBRARY_CATEGORIES = {
  image: ["空镜", "城市", "人物", "食物", "质感背景", "光效"],
  video: ["空镜", "城市", "自然", "人群", "光效", "慢镜头"],
  audio: ["氛围", "钢琴", "鼓点", "轻快", "悬疑", "环境音"],
  vector: [],
};

const DEFAULT_QUERY = {
  image: LIBRARY_CATEGORIES.image[0],
  video: LIBRARY_CATEGORIES.video[0],
  audio: LIBRARY_CATEGORIES.audio[0],
  vector: "",
};

const formatDuration = (seconds = 0) => {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  return `${String(minutes).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
};

function mapPexelsPhoto(photo) {
  return {
    id: `pexels-image-${photo.id}`, type: "image", src: photo.src?.large2x || photo.src?.large,
    thumbnail: photo.src?.medium, name: photo.alt || `Pexels photo ${photo.id}`,
    meta: `${photo.width} × ${photo.height} · Pexels`, width: photo.width, height: photo.height,
    provider: "Pexels", creator: photo.photographer, creatorUrl: photo.photographer_url,
    sourceUrl: photo.url, license: "Pexels License", licenseUrl: "https://www.pexels.com/license/",
  };
}

function mapPexelsVideo(video) {
  const files = [...(video.video_files || [])].filter((file) => file.link).sort((a, b) => (b.width || 0) - (a.width || 0));
  const source = files.find((file) => (file.width || 0) <= 1920) || files[0];
  return {
    id: `pexels-video-${video.id}`, type: "video", src: source?.link, thumbnail: video.image,
    name: `Pexels video ${video.id}`, meta: `${source?.width || video.width} × ${source?.height || video.height} · ${formatDuration(video.duration)}`,
    width: source?.width || video.width, height: source?.height || video.height, duration: video.duration,
    trackFrames: [], provider: "Pexels", creator: video.user?.name, creatorUrl: video.user?.url,
    sourceUrl: video.url, license: "Pexels License", licenseUrl: "https://www.pexels.com/license/",
  };
}

function stripHtml(value = "") {
  const element = document.createElement("div"); element.innerHTML = value; return element.textContent || "";
}

function mapCommonsPage(page, type) {
  const info = page.imageinfo?.[0] || page.videoinfo?.[0] || {};
  const metadata = info.extmetadata || {};
  const duration = Number.parseFloat(info.duration ?? metadata.Duration?.value) || 0;
  const license = metadata.LicenseShortName?.value || "Free license";
  const derivative = type === "video"
    ? [...(info.derivatives || [])].filter((item) => item.src && item.type?.startsWith("video/") && item.width <= 1280).sort((a, b) => Math.abs((a.width || 0) - 854) - Math.abs((b.width || 0) - 854))[0]
    : type === "audio"
      ? (info.derivatives || []).find((item) => item.src && item.type?.startsWith("audio/"))
      : null;
  const editorSrc = type === "image" ? info.thumburl || info.url : derivative?.src || info.url;
  // Wikimedia only serves a fixed allowlist of thumbnail widths. Keep the
  // API-provided URL intact instead of rewriting it to an unsupported size.
  const thumbnail = type === "image" ? editorSrc : type === "video" ? info.thumburl : "";
  return {
    id: `commons-${type}-${page.pageid}`, type, src: editorSrc, originalSrc: info.url, thumbnail,
    name: page.title?.replace(/^File:/, "") || `Commons ${type}`,
    meta: type === "audio" ? `${formatDuration(duration)} · ${license}` : `${info.width || "—"} × ${info.height || "—"} · ${license}`,
    width: info.width, height: info.height, duration: duration || undefined, trackFrames: type === "video" ? [] : undefined,
    provider: "Wikimedia Commons", creator: stripHtml(metadata.Artist?.value || ""),
    sourceUrl: info.descriptionurl, license,
    licenseUrl: metadata.LicenseUrl?.value || info.descriptionurl,
  };
}

export function mapOpenverseAudio(item) {
  const source = item.url || item.alt_files?.find((file) => file.url)?.url;
  const duration = Math.max(0, (Number(item.duration) || 0) / 1000);
  return {
    id: `openverse-audio-${item.id}`, type: "audio", kind: "music", src: source, previewSrc: source,
    thumbnail: item.thumbnail || "", name: item.title || `Openverse music ${item.id}`, duration,
    meta: `${formatDuration(duration)} · ${String(item.license || "CC").toUpperCase()}`,
    provider: "Openverse", creator: item.creator, creatorUrl: item.creator_url,
    sourceUrl: item.foreign_landing_url, license: String(item.license || "").toUpperCase(),
    licenseUrl: item.license_url, attribution: item.attribution,
  };
}

async function searchCommons(type, query, signal) {
  const filetype = type === "image" ? "bitmap" : type;
  const timedMedia = type === "video" || type === "audio";
  const params = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: `${query} filetype:${filetype}`,
    gsrnamespace: "6", gsrlimit: "24", prop: timedMedia ? "videoinfo" : "imageinfo",
    [timedMedia ? "viprop" : "iiprop"]: "url|size|mime|extmetadata|derivatives",
    [timedMedia ? "viurlwidth" : "iiurlwidth"]: "1280", format: "json", origin: "*",
  });
  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { signal });
  if (!response.ok) throw new Error(`Commons ${response.status}`);
  const data = await response.json();
  return Object.values(data.query?.pages || {}).map((page) => mapCommonsPage(page, type)).filter((asset) => asset.src);
}

async function searchPexels(type, query, key, signal) {
  const path = type === "video" ? "videos/search" : "search";
  const params = new URLSearchParams({ query, per_page: "24", orientation: "all" });
  const response = await fetch(`https://api.pexels.com/v1/${path}?${params}`, { headers: { Authorization: key }, signal });
  if (!response.ok) throw new Error(`Pexels ${response.status}`);
  const data = await response.json();
  return type === "video" ? (data.videos || []).map(mapPexelsVideo) : (data.photos || []).map(mapPexelsPhoto);
}

/**
 * FORK: an Openverse image mapper, so a machine with no Pexels key still gets
 * usable stills.
 *
 * Upstream falls back to Wikimedia Commons, which is an encyclopaedia: its
 * pictures are diagrams, specimens and monuments, licensed cleanly but almost
 * never what a cut needs. Openverse indexes the same CC-licensed world the
 * audio tab already searches, needs no key either, and can be filtered to the
 * licences that permit reuse.
 */
export function mapOpenverseImage(item) {
  const width = Number(item.width) || 0;
  const height = Number(item.height) || 0;
  return {
    id: `openverse-image-${item.id}`, type: "image", src: item.url,
    thumbnail: item.thumbnail || item.url, name: item.title || `Openverse image ${item.id}`,
    meta: `${width && height ? `${width} × ${height} · ` : ""}${String(item.license || "CC").toUpperCase()}`,
    width, height,
    provider: "Openverse", creator: item.creator, creatorUrl: item.creator_url,
    sourceUrl: item.foreign_landing_url, license: String(item.license || "").toUpperCase(),
    licenseUrl: item.license_url, attribution: item.attribution,
  };
}

export async function searchOpenverseImages(query, signal) {
  // Anonymous requests permit at most 20 results; 24 is rejected as HTTP 401.
  const params = new URLSearchParams({ q: query, page_size: "20", license: "cc0,by,pdm" });
  const response = await fetch(`https://api.openverse.org/v1/images/?${params}`, { signal });
  if (!response.ok) throw new Error(`Openverse ${response.status}`);
  const data = await response.json();
  return (data.results || []).map(mapOpenverseImage).filter((asset) => asset.src);
}

// FORK: the community library — our own catalogue, in front of the foreign
// ones. This is the whole point of the asset panel for this product: the
// upstream sources are stock libraries for a Western market, and what a person
// here reaches for is what people here have shared.
//
// Never throws and never rejects: a failure here returns nothing and the
// foreign sources still fill the panel. Our catalogue being down is not a
// reason for the library to be empty.
async function searchCommunityMedia(type, query, signal) {
  if (type === "vector") return [];
  try {
    const params = new URLSearchParams({ kind: type, limit: "24" });
    // Only filter by text once someone has actually typed. The category chips
    // are presets aimed at a stock-photo search; applied to a small community
    // library they would filter it to nothing, which reads as "there is
    // nothing here" rather than "nothing matched that word".
    if (query && query !== DEFAULT_QUERY[type]) params.set("q", query);
    const response = await fetch(`/api/community/media?${params}`, { signal });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.items || []).map(mapCommunityMedia).filter((asset) => asset.src);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return [];
  }
}

// FORK: the team's shared media, which is the OTHER half of "our own library".
//
// The community catalogue is what everyone published; this is what the people
// you work with put in reach. For a film that is usually the more useful of the
// two — the footage your colleague generated this morning is not on a public
// catalogue and never will be.
//
// Which team is answered by the same directory the rail's team block reads, so
// the panel does not invent a second idea of "current workspace". No team, or a
// personal workspace selected, means no rows and no request.

async function currentTeamWorkspaceId(signal, hostWorkspace) {
  if (hostWorkspace) return hostWorkspace.current();
  // Standalone fallback. Never cache an aborted or old-account directory.
  const response = await fetch("/api/workspace/directory", { signal });
  if (!response.ok) return null;
  const data = await response.json();
  const active = (data.items || []).find((item) => item.workspaceId === data.activeWorkspaceId);
  return active?.workspaceType === "team" ? active.workspaceId : null;
}

// FORK: team media, mapped into the shape the panel already draws.
//
// Two things the community rows have and these do not: a preview image and a
// playable URL. The list deliberately carries neither — a read capability lasts
// about a month, so one is minted only when someone actually picks the asset
// (the shared remote-asset loader). Until then the card shows what it truthfully
// knows: a name, a size, and who shared it.
const TEAM_MEDIA_KIND = { image: "image", video: "video", audio: "audio" };

function teamMediaKind(contentType) {
  const top = String(contentType || "").split("/")[0];
  return TEAM_MEDIA_KIND[top] || null;
}

function mapTeamMedia(item, workspaceId) {
  const kind = teamMediaKind(item.contentType);
  if (!kind) return null;
  const size = typeof item.sizeBytes === "number" && item.sizeBytes > 0
    ? `${Math.max(1, Math.round(item.sizeBytes / 1024 / 1024 * 10) / 10)} MB`
    : "";
  return {
    id: `team-${workspaceId}-${item.assetId}`,
    type: kind,
    // Resolved on demand — see lib/teamMedia.js. An empty src would make the
    // panel drop the row, so the asset id rides here behind a scheme the
    // prefetch path recognises.
    src: `vibedev-team-media:${encodeURIComponent(workspaceId)}/${encodeURIComponent(item.assetId)}`,
    name: item.filename || item.assetId,
    meta: [size, item.sharedBy || "", "团队共享"].filter(Boolean).join(" · "),
    trackFrames: [],
    provider: "团队共享",
    creator: item.sharedBy || "",
  };
}

async function searchTeamMedia(type, query, signal, hostWorkspace) {
  if (type === "vector") return [];
  try {
    const workspaceId = await currentTeamWorkspaceId(signal, hostWorkspace);
    if (!workspaceId) return [];
    const response = await fetch(
      `/api/team/${encodeURIComponent(workspaceId)}/media`,
      { signal },
    );
    if (!response.ok) return [];
    const data = await response.json();
    const rows = (data.items || []).map((item) => mapTeamMedia(item, workspaceId)).filter(Boolean)
      .filter((asset) => asset.type === type);
    // The gateway has no text search on this family and a team library is small,
    // so filtering happens here — and only once someone has actually typed,
    // for the same reason the community rows are not filtered by the category
    // chips: a preset aimed at stock photos would empty a small library and
    // read as "there is nothing here".
    const q = query && query !== DEFAULT_QUERY[type] ? query.toLowerCase() : "";
    return q ? rows.filter((asset) => asset.name.toLowerCase().includes(q)) : rows;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return [];
  }
}

// FORK: one community item, in the shape the panel already draws.
const COMMUNITY_LICENSE_LABEL = {
  self_made: "原创",
  cc0: "CC0",
  licensed: "已获授权",
};

function mapCommunityMedia(item) {
  const seconds = typeof item.durationMs === "number" ? item.durationMs / 1000 : 0;
  const size = typeof item.sizeBytes === "number" && item.sizeBytes > 0
    ? `${Math.max(1, Math.round(item.sizeBytes / 1024 / 1024 * 10) / 10)} MB`
    : "";
  return {
    id: `community-${item.id}`,
    type: item.kind,
    src: item.downloadUrl,
    thumbnail: item.previewUrl || undefined,
    name: item.title || item.slug || `#${item.id}`,
    meta: [seconds ? formatDuration(seconds) : "", size, "VibeDev 社区"].filter(Boolean).join(" · "),
    ...(seconds ? { duration: seconds } : {}),
    trackFrames: [],
    provider: "VibeDev 社区",
    creator: item.uploader?.name || "",
    // What the uploader claims about provenance is the whole basis on which
    // anyone may reuse this, so it travels with the asset rather than being
    // dropped at the panel.
    license: COMMUNITY_LICENSE_LABEL[item.license?.kind] || "",
  };
}

async function searchOpenverseAudio(query, signal) {
  const params = new URLSearchParams({ q: query, page_size: "20", license: "cc0,by,pdm", categories: "music" });
  const response = await fetch(`https://api.openverse.org/v1/audio/?${params}`, { signal });
  if (!response.ok) throw new Error(`Openverse ${response.status}`);
  const data = await response.json();
  return (data.results || []).map(mapOpenverseAudio)
    .filter((asset) => asset.src && asset.duration >= 15 && asset.duration <= 600)
    .slice(0, 24);
}

export function useEditorCatalog(voiceFilter, hostWorkspace = null) {
  const [libraryType, setLibraryType] = useState("image");
  const [libraryQuery, setLibraryQuery] = useState(DEFAULT_QUERY.image);
  const [builtInAssets, setBuiltInAssets] = useState([]);
  const [libraryStatus, setLibraryStatus] = useState("loading");
  const [libraryError, setLibraryError] = useState("");
  const [assetDownloadStates, setAssetDownloadStates] = useState({});
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  useEffect(() => {
    const changed = () => {
      clearRemoteAssetCache(); setBuiltInAssets([]); setAssetDownloadStates({});
      setWorkspaceRevision((revision) => revision + 1);
    };
    return hostWorkspace?.subscribe(changed);
  }, [hostWorkspace]);
  const pexelsKey = String(import.meta.env.VITE_PEXELS_API_KEY || "").trim();

  const filteredVoices = useMemo(() => VOICES.filter((voice) => voiceFilter === "all" || voice.language === voiceFilter), [voiceFilter]);

  useEffect(() => {
    const controller = new AbortController();
    if (libraryType === "vector") {
      const query = libraryQuery.trim().toLocaleLowerCase();
      const assets = query
        ? VECTOR_ASSETS.filter((item) => `${item.name} ${item.tags.join(" ")}`.toLocaleLowerCase().includes(query))
        : VECTOR_ASSETS;
      setBuiltInAssets(assets);
      setLibraryStatus("ready");
      setLibraryError("");
      return () => controller.abort();
    }
    setLibraryStatus("loading"); setLibraryError("");
    const timer = setTimeout(async () => {
      try {
        const query = libraryQuery.trim() || DEFAULT_QUERY[libraryType];
        // FORK: without a Pexels key, stills come from Openverse rather than
        // Wikimedia Commons. Video has no keyless source at all, so it still
        // falls back to Commons — thin, but better than an empty tab.
        //
        // FORK: the community catalogue runs alongside and goes FIRST. The two
        // are fetched together rather than in sequence so our own library does
        // not wait behind a foreign API, and the foreign one is not skipped
        // when ours is thin — with a young community, a panel showing only
        // ours would be nearly empty, and one showing only theirs is the
        // problem this replaces.
        const results = await Promise.allSettled([
          searchTeamMedia(libraryType, query, controller.signal, hostWorkspace),
          searchCommunityMedia(libraryType, query, controller.signal),
          libraryType === "audio"
            ? searchOpenverseAudio(query, controller.signal)
            : pexelsKey
              ? searchPexels(libraryType, query, pexelsKey, controller.signal)
              : libraryType === "image"
                ? searchOpenverseImages(query, controller.signal)
                : searchCommons(libraryType, query, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        const team = results[0].status === "fulfilled" ? results[0].value : [];
        const community = results[1].status === "fulfilled" ? results[1].value : [];
        const external = results[2].status === "fulfilled" ? results[2].value : [];
        const failed = results.find((result) => result.status === "rejected");
        // Keep either source's usable results even when the other is down.
        // With no usable results, retain the existing visible error state.
        if (!team.length && !community.length && !external.length && failed) throw failed.reason;
        setBuiltInAssets([...team, ...community, ...external]); setLibraryStatus("ready");
      } catch (error) {
        if (error.name === "AbortError") return;
        setBuiltInAssets([]); setLibraryStatus("error"); setLibraryError(error.message || "Unable to load media");
      }
    }, 320);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [libraryQuery, libraryType, pexelsKey, workspaceRevision, hostWorkspace]);

  const selectLibraryType = (type) => { setLibraryType(type); setLibraryQuery(DEFAULT_QUERY[type]); };
  const prefetchLibraryAsset = async (asset) => {
    if (!asset?.src || assetDownloadStates[asset.id]?.status === "ready") return;
    setAssetDownloadStates((states) => ({ ...states, [asset.id]: { status: "loading", progress: states[asset.id]?.progress || 0 } }));
    try {
      let lastProgressBucket = -1;
      await getRemoteAssetBlob(asset, (progress) => {
        const progressBucket = progress >= 1 ? 20 : Math.floor(progress * 20);
        if (progressBucket === lastProgressBucket) return;
        lastProgressBucket = progressBucket;
        setAssetDownloadStates((states) => ({ ...states, [asset.id]: { status: progress >= 1 ? "ready" : "loading", progress } }));
      });
    } catch {
      setAssetDownloadStates((states) => ({ ...states, [asset.id]: { status: "error", progress: 0 } }));
    }
  };
  return { builtInAssets, filteredVoices, libraryType, libraryQuery, setLibraryQuery, selectLibraryType, libraryStatus, libraryError, assetDownloadStates, prefetchLibraryAsset, libraryProvider: libraryType === "vector" ? "Timeline Studio" : libraryType === "audio" ? "Openverse Music" : pexelsKey ? "Pexels" : libraryType === "image" ? "Openverse" : "Wikimedia Commons",
    // FORK: the presets the panel offers for the current tab.
    libraryCategories: LIBRARY_CATEGORIES[libraryType] || [] };
}
