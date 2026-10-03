/**
 * True when ffmpeg read the file and reported no audio stream in it. False for
 * a run that reported no streams at all — that is a file we could not read,
 * not a file with nothing to hear, and it has to stay a failure.
 */
export function reportsNoAudioStream(logLines?: readonly unknown[]): boolean;

/** True for the one extraction failure that costs the render nothing. */
export function isSilentSourceError(error: unknown): boolean;

/**
 * The error to throw for a failed extraction: the failure itself, unless
 * ffmpeg's log says there was never a sound in the file to extract, in which
 * case a silent-source error carrying it as `cause`.
 */
export function describeSourceAudioFailure(
  error: unknown,
  logLines?: readonly unknown[],
): unknown;
