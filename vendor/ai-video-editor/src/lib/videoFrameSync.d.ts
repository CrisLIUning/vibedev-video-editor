export function requestLatestVideoFrame(video: HTMLVideoElement | null, targetTime: number, options?: {
  immediate?: boolean;
  onPresented?: (mediaTime: number) => void;
}): void;
export function cancelLatestVideoFrameRequest(video: HTMLVideoElement | null): void;
