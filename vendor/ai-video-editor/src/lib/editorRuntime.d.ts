export function runAvatarWorkerTask<T = Record<string, unknown>>(
  worker: Worker,
  message: unknown,
  transfer: Transferable[],
  terminalType: string,
  onProgress?: (progress: Record<string, unknown>) => void,
  options?: { signal?: AbortSignal },
): Promise<T>;

export function getNearestRatioIdForSize(width: unknown, height: unknown): string;

/** FORK: the identity of the first sized visual — what the auto-ratio effect compares. */
export function getAutoRatioSourceKey(visualSegments: unknown): string;
/** FORK: the identity of the first visual, sized or not — what a document import primes. */
export function getAutoRatioBaselineKey(visualSegments: unknown): string;
