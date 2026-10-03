import { startProcessedMedia } from "../lib/processedMediaCapability.js";
import { loadHostSourceAudioBlob } from "../lib/sourceAudioRestore.js";
import { useCallback, useEffect, useRef } from "react";
import { concatenateAudioBlobs, decodeWaveform, extractAudioFromVideo } from "../lib/media.js";
import { attachSourceAudioOffset, getSourceAudioAssetId } from "../lib/sourceAudioSync.js";
import { loadSourceAudioBlob, resolveSourceAudioInputAsset } from "../lib/sourceAudioAsset.js";

export function useSourceAudioExtraction(d) {
  const active = useRef(null);
  useEffect(() => () => active.current?.abort(), [d.capabilityRuntime]);
  return useCallback(async (asset, timelineStart = 0, options = {}) => {
    if (active.current) return false;
    const controller = new AbortController(); active.current = controller;
    let operation;
    d.setStatus("generating"); d.setStatusText(asset.compatibilityAudioBlob ? d.t("mediaCompatibilityProcessing") : "正在分离视频原声"); d.setProgress(12);
    try {
      operation = await startProcessedMedia(d.capabilityRuntime, { capability: "audio-extraction", title: "提取视频原声", source: asset, signal: controller.signal });
      const sourceBlob = asset.compatibilityAudioBlob instanceof Blob
        ? asset.compatibilityAudioBlob
        : await loadSourceAudioBlob(asset, d.userAssets, undefined, (progress) => {
          d.setProgress(Math.max(12, Math.min(36, 12 + progress * 24)));
        });
      if (!(sourceBlob instanceof Blob)) {
        d.setStatus("ready"); d.setProgress(0);
        throw new Error("当前视频素材缺少原文件，无法分离原声");
      }
      operation.check();
      const extractedBlob = asset.compatibilityAudioBlob instanceof Blob ? sourceBlob : await extractAudioFromVideo(sourceBlob, asset.name);
      d.setStatusText("解析视频原声波形"); d.setProgress(78);
      const extracted = await decodeWaveform(extractedBlob, 96); if (!extracted.duration) throw new Error("视频没有可识别的音频轨");
      if (options.destination === "audio") {
        const playbackRate = Math.max(0.25, Math.min(4, Number(asset.playbackRate) || 1));
        const sourceStart = Math.max(0, Number(asset.sourceStart) || 0);
        const timelineDuration = Math.min(
          Math.max(0, Number(asset.duration) || 0),
          Math.max(0, (extracted.duration - sourceStart) / playbackRate),
        );
        if (!(timelineDuration > 0)) throw new Error("画中画片段没有可分离的音频区间");
        const sourceName = `${asset.name.replace(/\.[^.]+$/, "")} 原声.wav`;
        const clipId = `extracted:${operation.task.taskId}`;
        await operation.complete([{ blob: extractedBlob, title: sourceName, fileName: sourceName,
          placement: { track: "audio", clipId, start: timelineStart, duration: timelineDuration, sourceStart,
            sourceDuration: timelineDuration * playbackRate, playbackRate, muteOverlayClipId: asset.id } }]);
        d.notify("画中画原声已分离到音频轨");
        return { track: "audio", segmentId: clipId };
      }
      const existing = d.sourceAudioBlob || (options.append === true && d.sourceAudioSource
        ? await loadHostSourceAudioBlob(d.sourceAudioSource, d.authorizedAssetsRef?.current || [], { extractVideoAudio: extractAudioFromVideo }) : null);
      if (options.append === true && d.sourceAudioDuration > 0 && !existing) throw new Error("原声音轨暂时不可读，未替换已有音频");
      const shouldAppend = options.append === true && existing instanceof Blob;
      const sourceAudioOffset = shouldAppend ? Math.max(0, Number(d.sourceAudioDuration) || 0) : 0;
      const sourceAudioAssetId = getSourceAudioAssetId(asset);
      const blob = shouldAppend ? await concatenateAudioBlobs([existing, extractedBlob]) : extractedBlob;
      const decoded = shouldAppend ? await decodeWaveform(blob, 192) : extracted;

      const sourceName = shouldAppend ? "视频原声合集.wav" : `${asset.name.replace(/\.[^.]+$/, "")} 原声.wav`;
      operation.check();
      const mapped = attachSourceAudioOffset(d.visualSegmentsRef?.current || [], asset, sourceAudioOffset);
      const targets = mapped.filter(item => item.sourceAudioOffset === sourceAudioOffset && (item.id === asset.id || item.assetId === sourceAudioAssetId));
      await operation.complete([{ blob, title: sourceName, fileName: sourceName,
        placement: { track: "source", replace: true, start: shouldAppend ? (d.sourceAudioStart || 0) : timelineStart,
          duration: decoded.duration, linkedSourceAssetId: shouldAppend ? "" : sourceAudioAssetId,
          sourceOffsets: targets.map(item => ({ clipId: item.id, offset: sourceAudioOffset })) } }]);
      d.setStatus("ready"); d.setProgress(100);
      return { track: "source", segmentId: asset.id };
    } catch (error) {
      await operation?.fail(error);
      console.warn(error); d.setStatus("ready"); d.setStatusText("视频未检测到可分离原声");
      d.setProgress(0); if (!controller.signal.aborted) d.notify(error?.message || "视频画面已保留，原声未能保存");
      return false;
    } finally { if (active.current === controller) active.current = null; }
  }, [d]);
}
