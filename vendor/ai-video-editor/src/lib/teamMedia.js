// Stable, workspace-scoped identity. Resolve only when previewing or inserting.
export function isTeamMediaSource(src) {
  return String(src || "").startsWith("vibedev-team-media:");
}

export async function resolveTeamMediaSrc(src) {
  if (!isTeamMediaSource(src)) return src;
  const parts = String(src).slice("vibedev-team-media:".length).split("/");
  if (parts.length !== 2 || parts.some((part) => !part)) throw new Error("Invalid shared media identity");
  const [workspaceId, assetId] = parts.map(decodeURIComponent);
  const response = await fetch(
    `/api/team/${encodeURIComponent(workspaceId)}/media/${encodeURIComponent(assetId)}/url`,
  );
  if (!response.ok) throw new Error(`Shared media unavailable (${response.status})`);
  const data = await response.json();
  if (!/^https?:\/\//i.test(data.url || "")) throw new Error("Shared media URL unavailable");
  return data.url;
}
