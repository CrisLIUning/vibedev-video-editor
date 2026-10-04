import { useCallback } from "react";
import { isModelDownloadError } from "../lib/modelSources.js";
import {
  isPiperSymbolError, isStorageQuotaError, splitTextAtSentenceEnd, TtsInputError,
} from "../lib/ttsText.js";
import {
  applyVoiceOutputGain, cancelOpenVoiceTasks, convertVoiceBlob, extractVoiceEmbedding, OPENVOICE_EMBEDDING_VERSION,
} from "../lib/openVoiceRuntime.js";
import { synthesizeBaseVoice } from "../lib/baseVoiceSynthesis.js";
import { KOKORO_VOICES_ENABLED } from "../config/vibedevFeatures.js";
import { cancelHojoVoiceGeneration } from "../lib/hojoTtsRuntime.js";
import { startVoiceGenerationCapability } from "../lib/voiceGenerationCapability.js";
import { decodeWaveform } from "../lib/media.js";
import { DEFAULT_GENERATED_VOICE_GAP, getGeneratedVoiceAppendStart } from "../lib/generatedVoicePlacement.js";

export function useVoiceGeneration(d) {
  return useCallback(async (captionSegment = null) => {
    captionSegment = captionSegment?.id && typeof captionSegment?.text === "string"
      ? captionSegment
      : null;
    const rawText = (captionSegment?.text ?? d.script).trim();
    if (!rawText || d.status === "generating" || d.status === "captioning") return;
    d.setVoiceTab("synthesis"); d.setStatus("generating"); d.setStatusText("ttsStatusPreparingModel"); d.setProgress(6);
    let capabilitySession = null;
    let removeAbortListener = () => {};
    try {
      const sentenceSegments = d.selectedVoice.engine === "hojo"
        ? splitTextAtSentenceEnd(rawText)
        : [rawText];
      capabilitySession = await startVoiceGenerationCapability({
        capabilityRuntime: d.capabilityRuntime,
        voiceName: d.selectedVoice.name,
        // Cloning keeps the built-in engine voice and swaps the profile, so the
        // profile is the voice the person actually chose to hear.
        voiceProfileName: d.selectedVoiceProfile?.name || "",
        voiceId: d.selectedVoice.id,
        voiceEngine: d.selectedVoice.engine,
        segmentCount: sentenceSegments.length,
      });
      const throwIfCanceled = () => {
        if (capabilitySession.signal?.aborted) {
          throw capabilitySession.signal.reason || new DOMException("Canceled", "AbortError");
        }
      };
      const cancelLocalRuntime = () => {
        if (d.selectedVoice.engine === "hojo") cancelHojoVoiceGeneration();
        cancelOpenVoiceTasks();
      };
      capabilitySession.signal?.addEventListener("abort", cancelLocalRuntime, { once: true });
      removeAbortListener = () => capabilitySession?.signal?.removeEventListener("abort", cancelLocalRuntime);
      throwIfCanceled();
      let targetEmbedding = d.selectedVoiceProfile?.embedding;
      if (targetEmbedding) {
        if (
          d.selectedVoiceProfile.embeddingVersion !== OPENVOICE_EMBEDDING_VERSION
          && d.selectedVoiceProfile.referenceBlob
        ) {
          d.setStatusText(d.t("cloneEncoding", "重新提取音色"));
          targetEmbedding = await extractVoiceEmbedding(d.selectedVoiceProfile.referenceBlob, (event) => {
            if (event.phase) d.setStatusText(event.phase);
            if (Number.isFinite(event.progress)) d.setProgress(Math.max(1, Math.min(45, Math.round(event.progress * 0.45))));
          });
          await d.addVoiceProfile?.({
            ...d.selectedVoiceProfile,
            embedding: Float32Array.from(targetEmbedding),
            embeddingVersion: OPENVOICE_EMBEDDING_VERSION,
            updatedAt: new Date().toISOString(),
          });
        }
      }
      const generatedItems = [];
      for (let index = 0; index < sentenceSegments.length; index += 1) {
        throwIfCanceled();
        const sentence = sentenceSegments[index];
        if (sentenceSegments.length > 1) {
          d.setStatusText(d.t("ttsStatusGeneratingSegment")
            .replace("{current}", index + 1)
            .replace("{total}", sentenceSegments.length));
        }
        let { blob } = await synthesizeBaseVoice({
          voice: d.selectedVoice, text: sentence, speed: d.speed, notify: d.notify, t: d.t,
          modelArtifacts: capabilitySession.modelArtifacts,
          onStatus: sentenceSegments.length > 1 ? undefined : d.setStatusText,
          onProgress: (value) => {
            const overall = 8 + ((index + Math.max(0, Math.min(100, value)) / 100) / sentenceSegments.length) * 82;
            d.setProgress(Math.min(90, Math.round(overall)));
            void capabilitySession.progress({ progress: Math.min(90, Math.round(overall)), phase: `segment ${index + 1}/${sentenceSegments.length}` }).catch(() => undefined);
          },
        });
        if (targetEmbedding) {
          d.setStatusText(sentenceSegments.length > 1
            ? d.t("ttsStatusConvertingSegment").replace("{current}", index + 1).replace("{total}", sentenceSegments.length)
            : d.t("cloneStageTwo", "第 2 步：转换为克隆音色"));
          blob = await convertVoiceBlob(blob, targetEmbedding, {
            seed: 2026 + index,
            onProgress: (event) => {
              if (sentenceSegments.length === 1 && event.phase) d.setStatusText(event.phase);
              if (Number.isFinite(event.progress)) {
                const overall = 8 + ((index + Math.max(0, Math.min(100, event.progress)) / 100) / sentenceSegments.length) * 82;
                d.setProgress(Math.min(90, Math.round(overall)));
              }
            },
          });
        }
        blob = await applyVoiceOutputGain(blob, d.volume);
        throwIfCanceled();
        generatedItems.push({ blob, script: sentence });
      }
      const decodedItems = await Promise.all(generatedItems.map(async (item) => ({
        ...item,
        decoded: await decodeWaveform(item.blob),
      })));
      const replacementClipId = captionSegment
        ? captionSegment.audioSegmentId || captionSegment.detachedAudioSegmentId || ""
        : "";
      const rememberedVoiceEnd = Number(d.generatedVoiceEndRef?.current) || 0;
      // Every playhead/segment read here is optional. The hook is called with a
      // subset of the editor's refs, and `d.currentTimeRef.current` was the one
      // read without `?.` — so a caller that did not pass it threw
      // "Cannot read properties of undefined (reading 'current')" at placement
      // and the generated audio never landed (field report 2026-09-03, local
      // TTS engine). A missing ref must cost placement accuracy, not the run.
      const playheadSeconds = Number(d.currentTimeRef?.current) || 0;
      const placementSegments = d.audioSegmentsRef?.current ?? d.audioSegments ?? [];
      let placementCursor = captionSegment
        ? Math.max(0, Number(captionSegment.start) || 0)
        : Math.max(
          rememberedVoiceEnd ? rememberedVoiceEnd + DEFAULT_GENERATED_VOICE_GAP : 0,
          getGeneratedVoiceAppendStart(placementSegments, playheadSeconds),
        );
      const placementItems = decodedItems.map((item, index) => {
        const timelineClipId = crypto.randomUUID();
        const placement = {
          track: "audio",
          clipId: timelineClipId,
          start: placementCursor,
          duration: item.decoded.duration,
          ...(index === 0 && replacementClipId ? { replaceClipId: replacementClipId } : {}),
        };
        placementCursor += item.decoded.duration + DEFAULT_GENERATED_VOICE_GAP;
        return { ...item, timelineClipId, placement };
      });
      const persistedItems = await capabilitySession.complete(placementItems);
      d.setStatusText("ttsStatusDecodingWaveform");
      d.setProgress((current) => Math.max(current, 96));
      const commitOptions = {
        captionSegment, script: rawText,
        sourceKind: d.selectedVoiceProfile ? "cloned-voiceover" : "ai-voiceover",
        cloneVoiceProfileId: d.selectedVoiceProfile?.id || "",
        cloneVoiceProfileName: d.selectedVoiceProfile?.name || "",
      };
      if (generatedItems.length > 1) {
        await d.commitAudioBatch(persistedItems, `${d.selectedVoice.name} · ${d.t("ttsGenerated")}`, commitOptions);
        d.notify(d.t("ttsNoticeSegmentedGenerated").replace("{count}", persistedItems.length));
      } else {
        const item = persistedItems[0];
        await d.commitAudio(item.blob, `${d.selectedVoice.name} · ${d.t("ttsGenerated")}`, {
          ...commitOptions,
          id: item.timelineClipId,
          decoded: item.decoded,
          start: item.placement?.start,
          assetId: item.hostAssetId || "",
          assetVersionId: item.hostVersionId || "",
          sourceUrl: item.hostUrl || "",
        });
        d.notify(d.t("ttsNoticeGenerated"));
      }
    } catch (error) {
      await capabilitySession?.fail(error);
      if (error?.name === "AbortError") {
        d.setStatus("ready"); d.setStatusText(d.t("taskCanceled", "已取消")); d.setProgress(0);
        return;
      }
      console.error(error);
      const message = error instanceof TtsInputError ? d.t(error.code)
        : /^HOJO_(?:DECODER_)?(?:SILENT|INVALID)_WAVEFORM$/.test(error?.message) ? d.t("ttsErrorSilentWaveform")
        // FORK: without English voices the hint does not offer switching to one (vibedevFeatures.js).
        : d.selectedVoice.engine === "piper" && isPiperSymbolError(error) ? d.t(KOKORO_VOICES_ENABLED ? "ttsErrorUnsupportedPiperSymbols" : "ttsErrorUnsupportedPiperSymbolsChineseOnly")
          : isStorageQuotaError(error) ? d.t("ttsErrorStorageQuota")
            : isModelDownloadError(error) ? d.t("ttsErrorModelDownload")
              : error instanceof Error ? error.message : d.t("ttsErrorGenerationFailed");
      d.setStatus("error"); d.setStatusText(message); d.setProgress(0); d.notify(message);
    } finally { removeAbortListener(); }
  }, [d]);
}
