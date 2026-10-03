import { useCallback } from "react";

export function localizeAutoCaptionPhase(phase, t) {
  const text = String(phase || "");
  const format = (key, fallback, values = {}) => Object.entries(values).reduce(
    (result, [name, value]) => result.replace(`{${name}}`, value),
    t(key, fallback),
  );
  if (text.includes("下载或读取") && text.includes("Whisper")) return t("asrDownloadingModel", text);
  if (text.includes("识别音频语言")) return t("asrDetectingLanguage", text);
  if (text.includes("初始化 WebGPU")) return t("asrInitializingWebGpu", text);
  if (text.includes("初始化 WASM")) return t("asrInitializingWasm", text);
  if (text.includes("WebGPU 初始化失败")) return t("asrFallingBackWasm", text);
  if (text.includes("解码原声音频")) return t("asrDecodingAudio", text);
  if (text.includes("Worker 不可用")) return t("asrWorkerFallback", text);
  if (text.includes("Worker 结果异常")) return t("asrRetryingWasm", text);
  if (text.includes("写入字幕轨道")) return t("asrWritingCaptions", text);
  const languageMatch = text.match(/(?:检测为|按)\s+(.+?)\s+转写字幕/);
  if (languageMatch) return format("asrTranscribingLanguage", text, { language: languageMatch[1] });
  return text;
}

export function useAutoCaptions(d) {
  return useCallback(async (options = {}) => {
    const inputBlob = options.blob ?? d.sourceAudioBlob;
    if (d.status === "generating" || d.status === "captioning") return;
    if (d.trackLocks.caption) return void d.notify(d.t("captionTrackLocked"));
    if (!inputBlob && !d.capabilityRuntime?.transcribeTimeline) return void d.notify(d.t("autoCaptionsNeedsSource"));
    d.setStatus("captioning"); d.setStatusText(d.t("autoCaptionsPreparing")); d.setProgress(4); d.setActiveTool("audio");
    try {
      if (d.capabilityRuntime?.transcribeTimeline) {
        const result = await d.capabilityRuntime.transcribeTimeline({
          ...(options.clipId ? {clipId:options.clipId} : {}), ...(options.track ? {track:options.track} : {}),
          ...(Number.isFinite(options.start) ? {start:options.start} : {}), ...(Number.isFinite(options.duration) ? {duration:options.duration} : {}),
          language:d.uiLanguage,
          onProgress:({progress,phase})=>{d.setProgress(progress);d.setStatusText(localizeAutoCaptionPhase(phase,d.t));},
        });
        if (result.backgroundTaskId) {
          d.setStatus("ready"); d.setStatusText(d.t("autoCaptionsBackground")); d.setProgress(0);
          d.notify(d.t("autoCaptionsBackground")); return;
        }
        // Host has saved through native commands and refreshed the document. Never apply a second local copy.
        const complete=d.t("autoCaptionsComplete").replace("{count}",result.segments.length);
        d.setStatus("done");d.setStatusText(complete);d.setProgress(100);d.setActiveTool("caption");
        d.seekTo(result.segments[0]?.start??0);d.notify(complete);return;
      }
      throw new Error("CAPTION_RUNTIME_UNAVAILABLE: 当前编辑器未连接原生字幕任务；请从 VibeDev 工作台打开。");
    } catch (error) {
      if (error?.name === "AbortError") {
        d.setStatus("ready"); d.setStatusText(d.t("taskCanceled", "已取消")); d.setProgress(0);
        return;
      }
      console.error(error); d.setStatus("error"); d.setStatusText(error instanceof Error ? error.message : d.t("autoCaptionsFailed"));
      d.setProgress(0); d.notify(d.t("autoCaptionsFailedHint"));
    }
  }, [d]);
}
