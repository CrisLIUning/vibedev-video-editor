import { useCallback, useEffect, useRef, useState } from "react";
import { decodeWaveform } from "../lib/media.js";
import { separateVocals } from "../lib/vocalSeparation.js";
import { renderAudioClipFile } from "../lib/audioClipExport.js";
import { startProcessedMedia } from "../lib/processedMediaCapability.js";

export function useVocalSeparation({ sourceAudioBlob, sourceAudioName, sourceAudioDuration, sourceAudioStart, sourceAudioSource, notify, t, capabilityRuntime, authorizedAssetsRef }) {
  const [job, setJob] = useState({ running: false, progress: 0, phase: "" });
  const active = useRef(null);
  useEffect(() => () => active.current?.abort(), [capabilityRuntime]);
  const cancel = useCallback(() => active.current?.abort(), []);
  const runClip = useCallback(async (source) => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setJob({ running: true, progress: 1, phase: t("vocalSeparationPreparing") });
    let operation;
    try {
      const target = { ...source, id: source.id || source.segmentId };
      operation = await startProcessedMedia(capabilityRuntime, { capability: "vocal-separation", title: target.name || "分离人声", source: target, signal: controller.signal });
      const prepared = await capabilityRuntime.prepareModel({ modelId: "timeline-studio-vocal-remover", signal: operation.task.signal,
        onProgress: update => { if (!controller.signal.aborted) setJob({ running: true, progress: (update.progress || 0) * .07, phase: update.phase }); } });
      operation.check();
      // Use the editor's own trim/rate/curve renderer; do not confuse source seconds with timeline seconds.
      const input = await renderAudioClipFile({ ...target, volume: 1, muted: false, fadeIn: 0, fadeOut: 0 }, authorizedAssetsRef?.current || [], { signal: operation.task.signal });
      operation.check();
      const result = await separateVocals(input.blob, (progress, phase) => {
        if (controller.signal.aborted) return;
        const phaseText = t(phase.key)
          .replace("{current}", String(phase.current ?? ""))
          .replace("{total}", String(phase.total ?? ""));
        setJob({ running: true, progress, phase: phaseText });
        void operation.progress({ progress, phase: phaseText }).catch(() => {});
      }, { modelUrl: prepared.artifacts?.["model.json"] || "", signal: operation.task.signal });
      operation.check();
      const [voice, music] = await Promise.all([decodeWaveform(result.vocals, 96), decodeWaveform(result.accompaniment, 96)]);
      operation.check();
      const name = (target.name || "audio").replace(/\.[^.]+$/, "");
      const placement = { track: target.wholeSource ? "source" : "audio", start: target.start || 0, duration: voice.duration, volume: target.volume ?? 1, muted: target.muted === true,
        ...(target.wholeSource ? { replace: true } : target.track === "source" ? { disableSourceClipId: target.id } : target.track === "music" ? { muteMusicClipId: target.id } : target.track === "audio" ? { replaceClipId: target.id, clipId: target.id } : {}) };
      await operation.complete([
        { blob: result.vocals, fileName: `${name}-vocals.wav`, title: `${name} · 人声`, placement },
        { blob: result.accompaniment, fileName: `${name}-instrumental.wav`, title: `${name} · 伴奏`, placement: { track: "audio", start: target.start || 0, duration: music.duration, volume: target.volume ?? 1, muted: target.muted === true } },
      ]);
      setJob({ running: false, progress: 100, phase: t("vocalSeparationComplete") }); notify(t("vocalSeparationComplete"));
    } catch (error) {
      await operation?.fail(error);
      setJob({ running: false, progress: 0, phase: "" });
      if (!controller.signal.aborted) notify(`${t("vocalSeparationFailed")}：${error.message}`);
    } finally { if (active.current === controller) active.current = null; }
  }, [capabilityRuntime, authorizedAssetsRef, notify, t]);
  const run = useCallback(() => runClip({ ...sourceAudioSource, blob: sourceAudioBlob, name: sourceAudioName, duration: sourceAudioDuration, start: sourceAudioStart, track: "source", id: "source-audio", wholeSource: true }), [runClip, sourceAudioBlob, sourceAudioName, sourceAudioDuration, sourceAudioStart, sourceAudioSource]);
  return { vocalSeparationJob: { ...job, cancel }, separateAudioClipVocals: runClip, separateSourceVocals: run };
}
