/**
 * Why a video clip's own sound did not reach the mix.
 *
 * There are two of these and they are not the same thing.
 *
 * A file with no audio stream has no sound to lose. The render is exactly
 * what the cut says, and reporting it would put a warning on every silent
 * b-roll shot in the project — which is most of them, because the shots the
 * film module generates are pictures. The headless lane already knows this:
 * the host probes each candidate and only the files that carry a sound
 * stream join the mix (`projectRenderPlan.getFfmpegRenderMediaRequirements`,
 * `media.sourceAudio`). Nothing is wrong and nobody is told.
 *
 * A file that HAS sound the export could not get — a refused request, a
 * decode that failed, ffmpeg falling over — loses something the person put in
 * the cut, and a render that quietly drops it is a wrong render.
 *
 * ffmpeg reports the input's streams before it fails, so its own log is what
 * separates the two. A run we cannot read that report for counts as a
 * failure, not as silence: the whole point is that missing sound is never
 * allowed to pass unnoticed, so the unreadable case fails loud.
 */

const SILENT_SOURCE = "SilentSourceError";

// `Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, ...`
const STREAM_LINE = /Stream #\d+:\d+/;
const AUDIO_STREAM_LINE = /Stream #\d+:\d+[^\n]*: Audio:/;

/**
 * True when ffmpeg read the file and reported no audio stream in it.
 *
 * The test is over every line rather than only the input report: ffmpeg names
 * an output audio stream just as it names an input one, and it can only name
 * one when it found one to map. False for a run that reported no streams at
 * all — that is a file we could not read, not a file with nothing to hear.
 */
export function reportsNoAudioStream(logLines = []) {
  const lines = logLines.filter((line) => typeof line === "string");
  if (lines.some((line) => AUDIO_STREAM_LINE.test(line))) return false;
  return lines.some((line) => STREAM_LINE.test(line));
}

/** True for the one failure that costs the render nothing. */
export function isSilentSourceError(error) {
  return error?.name === SILENT_SOURCE;
}

/**
 * The error to throw for a failed extraction: the failure itself, unless
 * ffmpeg's log says there was never a sound in the file to extract.
 */
export function describeSourceAudioFailure(error, logLines = []) {
  if (!reportsNoAudioStream(logLines)) return error;
  return silentSourceError(error);
}

/** The error for a file that was read and holds no audio stream. */
export function silentSourceError(cause) {
  const silent = new Error("视频没有音频轨", cause === undefined ? undefined : { cause });
  silent.name = SILENT_SOURCE;
  return silent;
}
