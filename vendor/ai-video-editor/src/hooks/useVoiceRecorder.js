import { useCallback } from "react";
import { decodeWaveform, getAudioRecordingFormat } from "../lib/media.js";
import { formatSavedTime } from "../lib/timeline.js";

export function useVoiceRecorder(d) {
  const commitRecording = useCallback(async (blob, extension = "webm") => {
    d.setRecordingState("processing"); d.setStatus("generating"); d.setStatusText(d.t("recording")); d.setProgress(72);
    try {
      const decoded = await decodeWaveform(blob); const createdAt = formatSavedTime();
      const recording = { id: crypto.randomUUID(), blob, name: `${d.t("recordVoice")} ${createdAt}`,
        duration: decoded.duration, peaks: decoded.peaks, createdAt, extension };
      d.setRecordedVoices((items) => [recording, ...items.slice(0, 8)]);
      d.setActiveTool("audio"); d.setVoiceTab("mine"); d.setStatus("ready");
      d.setStatusText(d.t("recordingReadyForClone", "录音已就绪，请完成克隆试听"));
      d.notify(d.t("recordingReadyForClone", "录音已就绪，请完成克隆试听"));
    } catch (error) {
      console.error(error); d.setStatus("error"); d.setStatusText(error instanceof Error ? error.message : d.t("recordingPermissionDenied"));
      d.notify(d.t("recordingPermissionDenied"));
    } finally { d.setRecordingState("idle"); d.setProgress(0); }
  }, [d]);
  const startVoiceRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return void d.notify(d.t("recordingUnsupported"));
    if (d.recordingState === "recording") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const format = getAudioRecordingFormat();
      const recorder = format?.mimeType ? new MediaRecorder(stream, { mimeType: format.mimeType }) : new MediaRecorder(stream);
      d.voiceRecorderStreamRef.current = stream; d.voiceRecorderChunksRef.current = []; d.voiceRecorderRef.current = recorder;
      d.voiceRecorderStartedAtRef.current = performance.now(); d.setRecordingElapsed(0); d.setRecordingState("recording");
      d.setStatus("generating"); d.setStatusText(d.t("recording")); d.setProgress(0);
      d.setActiveTool("audio"); d.setVoiceTab("mine");
      recorder.ondataavailable = (event) => { if (event.data?.size) d.voiceRecorderChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(d.voiceRecorderChunksRef.current, { type: recorder.mimeType || format?.mimeType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop()); d.voiceRecorderStreamRef.current = null; d.voiceRecorderRef.current = null;
        clearInterval(d.voiceRecorderTimerRef.current); d.voiceRecorderTimerRef.current = 0;
        d.setRecordingElapsed((performance.now() - d.voiceRecorderStartedAtRef.current) / 1000);
        if (blob.size > 0) void commitRecording(blob, format?.extension ?? "webm");
        else { d.setRecordingState("idle"); d.notify(d.t("recordingPermissionDenied")); }
      };
      recorder.start(250);
      d.voiceRecorderTimerRef.current = setInterval(() => d.setRecordingElapsed((performance.now() - d.voiceRecorderStartedAtRef.current) / 1000), 250);
    } catch (error) {
      console.error(error); d.setRecordingState("idle"); d.setStatus("error"); d.setStatusText(d.t("recordingPermissionDenied")); d.notify(d.t("recordingPermissionDenied"));
      d.voiceRecorderStreamRef.current?.getTracks().forEach((track) => track.stop()); d.voiceRecorderStreamRef.current = null;
    }
  }, [commitRecording, d]);
  const stopVoiceRecording = () => {
    const recorder = d.voiceRecorderRef.current; if (!recorder || recorder.state === "inactive") return;
    d.setRecordingState("processing"); recorder.stop();
  };
  return { startVoiceRecording, stopVoiceRecording };
}
