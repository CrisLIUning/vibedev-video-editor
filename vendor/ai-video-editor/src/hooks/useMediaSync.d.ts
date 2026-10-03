/** The editor's legacy state bag remains owned by App; the ref binds each newly mounted preview. */
export function useMediaSync(state: Record<string, unknown>): (node: HTMLVideoElement | null) => void;
export function syncTimelineAudioElement(media: { paused: boolean; currentTime: number; playbackRate: number; play(): unknown; pause(): void } | null, state: { active: boolean; shouldPlay: boolean; expectedTime: number; playbackRate?: number; segmentKey?: string }): void;
export function previewPlaybackRate(media: { paused: boolean; seeking: boolean; readyState: number; currentTime: number }, expectedTime: number, baseRate: number): number;
