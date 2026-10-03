import { useCallback, useEffect, useRef, useState } from "react";
import { createAutoEditTranslator, createFrameCaptionSession, extractAutoEditFrames, generateFrameCaptions, generateImageVoiceoverText, probeBuiltInAI } from "../lib/autoEdit.js";
import { startAutoEditCapability } from "../lib/autoEditCapability.js";
import { getVisualSegmentsTotal, makeId } from "../lib/timeline.js";

export function useAutoEdit({ language, visualSegments, captionSegments, commitCaptionSegments, setCaptionsEnabled, setTrackVisibility, setSelectedSegmentId, setSelectedTrack, notify, t, capabilityRuntime }) {
  const [support, setSupport] = useState({ availability: "unknown", reason: "", language: "en" });
  const [job, setJob] = useState({ running: false, progress: 0, phase: "" });
  const [review, setReview] = useState({ open: false, candidates: [], captions: [], segments: [], error: "" });
  const abortRef = useRef(null);
  const candidateUrlsRef = useRef([]);
  const clearCandidateUrls = useCallback(() => {
    candidateUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    candidateUrlsRef.current = [];
  }, []);
  useEffect(() => clearCandidateUrls, [clearCandidateUrls]);
  const checkSupport = useCallback(async () => {
    setSupport((value) => ({ ...value, availability: "checking" }));
    if (capabilityRuntime?.checkVisionSupport && capabilityRuntime?.describeFrames) {
      try {
        const host = await capabilityRuntime.checkVisionSupport();
        if (host?.available) {
          const result = { availability: "available", reason: "", language, provider: "vibedev", model: host.model || "" };
          setSupport(result);
          return result;
        }
      } catch {
        // A temporarily unavailable host falls back to the browser capability.
      }
    }
    const result = await probeBuiltInAI(language);
    setSupport(result);
    return result;
  }, [capabilityRuntime, language]);
  useEffect(() => { checkSupport(); }, [checkSupport]);
  const prepareSupport = useCallback(async () => {
    if (support.provider === "vibedev") return checkSupport();
    const environment = await probeBuiltInAI(language);
    if (environment.availability !== "downloadable" && environment.availability !== "downloading") {
      setSupport(environment);
      return environment;
    }
    setSupport({ ...environment, availability: "downloading", progress: 0 });
    let promptSession = null;
    let translator = null;
    const needsTranslation = environment.promptLanguage !== environment.language;
    let promptProgress = 0;
    let translationProgress = 0;
    const updateProgress = (kind, loaded) => {
      const value = Math.max(0, Math.min(1, Number(loaded) || 0));
      if (kind === "prompt") promptProgress = value;
      else translationProgress = value;
      const progress = Math.round((needsTranslation ? (promptProgress + translationProgress) / 2 : promptProgress) * 100);
      setSupport((value) => ({ ...value, availability: "downloading", progress }));
    };
    try {
      [promptSession, translator] = await Promise.all([
        createFrameCaptionSession({ language, onDownloadProgress: (loaded) => updateProgress("prompt", loaded) }),
        createAutoEditTranslator({ language, onDownloadProgress: (loaded) => updateProgress("translation", loaded) }),
      ]);
      const ready = await probeBuiltInAI(language);
      setSupport({ ...ready, progress: ready.availability === "available" ? 100 : undefined });
      return ready;
    } catch (error) {
      const failed = { ...environment, availability: "unavailable", reason: error?.name || "model-download-failed" };
      setSupport(failed);
      return failed;
    } finally {
      promptSession?.destroy?.();
      translator?.destroy?.();
    }
  }, [checkSupport, language, support.provider]);

  const generateImageCaption = useCallback(async (segment) => {
    if (!segment?.src || segment.type === "video" || support.availability !== "available" || job.running) return;
    const index = visualSegments.findIndex((item) => item.id === segment.id);
    if (index < 0) return;
    const start = visualSegments.slice(0, index).reduce((sum, item) => sum + Math.max(0, Number(item.duration) || 0), 0);
    const end = start + Math.max(0.2, Number(segment.duration) || 0.2);
    setJob({ running: true, progress: 15, phase: t("autoEditWritingCaptions") });
    try {
      let text;
      if (support.provider === "vibedev" && capabilityRuntime?.describeFrames) {
        const sourceUrl = new URL(segment.src, window.location.href);
        const response = await fetch(sourceUrl.href, {
          credentials: sourceUrl.origin === window.location.origin ? "same-origin" : "omit",
        });
        if (!response.ok) throw new Error(`image fetch failed (${response.status})`);
        const result = await capabilityRuntime.describeFrames({
          language,
          frames: [{ blob: await response.blob(), time: start }],
        });
        text = String(result?.captions?.[0] || "").trim();
        if (!text) throw new Error("VibeDev Vision returned no caption");
      } else {
        text = await generateImageVoiceoverText({ src: segment.src, language });
      }
      const previousCaption = [...captionSegments]
        .sort((left, right) => (Number(left.start) || 0) - (Number(right.start) || 0))
        .filter((item) => (Number(item.start) || 0) <= start)
        .at(-1);
      const caption = { id: makeId("caption"), text, start, end, hidden: false, fontId: previousCaption?.fontId || "default", visualSegmentId: segment.id };
      const next = [...captionSegments, caption].sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
      commitCaptionSegments(next, t("imageAiCaptionAdded"), next.findIndex((item) => item.id === caption.id));
      setCaptionsEnabled(true);
      setTrackVisibility((visibility) => ({ ...visibility, caption: true }));
      setSelectedTrack("caption"); setSelectedSegmentId(caption.id);
      notify(t("imageAiCaptionAdded"));
    } catch (error) {
      console.error(error);
      notify(t("imageAiCaptionFailed"));
    } finally {
      setJob({ running: false, progress: 0, phase: "" });
    }
  }, [capabilityRuntime, captionSegments, commitCaptionSegments, job.running, language, notify, setCaptionsEnabled, setSelectedSegmentId, setSelectedTrack, setTrackVisibility, support.availability, support.provider, t, visualSegments]);
  const run = useCallback(async () => {
    if (!visualSegments.length || job.running) return;
    const environment = support.availability === "unknown" ? await checkSupport() : support;
    if (environment.availability === "unavailable") return void notify(t("autoEditUnavailable"));
    abortRef.current = new AbortController();
    clearCandidateUrls();
    setReview({ open: true, candidates: [], captions: [], segments: [], error: "" });
    let session = null;
    let translator = null;
    let capabilitySession = null;
    setJob({ running: true, progress: 2, phase: t("autoEditFindingScenes") });
    const capabilityPromise = startAutoEditCapability({
      capabilityRuntime,
      language,
      segmentCount: visualSegments.length,
      signal: abortRef.current.signal,
    });
    const useHostVision = environment.provider === "vibedev" && Boolean(capabilityRuntime?.describeFrames);
    // Chrome requires LanguageModel.create() to happen during the button's
    // transient user activation when the model still needs downloading.
    const sessionPromise = useHostVision ? Promise.resolve(null) : createFrameCaptionSession({
      language,
      signal: abortRef.current.signal,
      onDownloadProgress: (loaded) => setJob({ running: true, progress: Math.max(4, Math.round(loaded * 55)), phase: t("autoEditDownloadingModel") }),
    });
    const translatorPromise = useHostVision ? Promise.resolve(null) : createAutoEditTranslator({
      language,
      signal: abortRef.current.signal,
      onDownloadProgress: (loaded) => setJob({ running: true, progress: Math.max(4, Math.round(loaded * 55)), phase: t("autoEditDownloadingModel") }),
    });
    try {
      capabilitySession = await capabilityPromise;
      const executionSignal = capabilitySession?.signal || abortRef.current.signal;
      capabilitySession?.signal.addEventListener("abort", () => {
        if (!abortRef.current?.signal.aborted) abortRef.current?.abort(capabilitySession.signal.reason);
      }, { once: true });
      const frames = await extractAutoEditFrames(visualSegments, (progress) => {
        setJob({ running: true, progress, phase: t("autoEditFindingScenes") });
        void capabilitySession?.progress({ progress, phase: "finding-scenes" }).catch(() => undefined);
      }, executionSignal);
      const candidates = frames.map((frame, index) => {
        const url = URL.createObjectURL(frame.blob);
        candidateUrlsRef.current.push(url);
        return { id: `${frame.segmentId}-${index}`, segmentId: frame.segmentId, segmentIndex: frame.segmentIndex, segmentName: frame.segmentName, url, time: frame.time, difference: frame.difference, aspectRatio: frame.aspectRatio };
      });
      const segments = candidates.reduce((items, candidate) => items.some((item) => item.id === candidate.segmentId) ? items : [...items, { id: candidate.segmentId, index: candidate.segmentIndex, name: candidate.segmentName, status: "waiting", error: "" }], []);
      setReview((value) => ({ ...value, candidates, segments }));
      setJob({ running: true, progress: 60, phase: t("autoEditWritingCaptions") });
      void capabilitySession?.progress({ progress: 60, phase: "writing-captions" }).catch(() => undefined);
      session = await sessionPromise;
      translator = await translatorPromise;
      const captions = await generateFrameCaptions({
        frames, duration: getVisualSegmentsTotal(visualSegments), language, session, translator, signal: executionSignal,
        describeFrames: useHostVision ? async (batch, signal) => (
          await capabilityRuntime.describeFrames({
            language,
            signal,
            frames: batch.map((frame) => ({ blob: frame.blob, time: frame.time })),
          })
        ).captions : undefined,
        onPartial: (partial) => {
          const modelProgress = partial.allWindows ? partial.completedWindows / partial.allWindows : 0;
          const progress = Math.min(96, 60 + Math.round(modelProgress * 36));
          setJob({ running: true, progress, phase: t("autoEditWritingCaptions") });
          void capabilitySession?.progress({ progress, phase: "writing-captions" }).catch(() => undefined);
          setReview((value) => ({
            ...value,
            captions: partial.captions.length ? [...value.captions.filter((caption) => caption.visualSegmentId !== partial.segmentId), ...partial.captions].sort((a, b) => a.start - b.start) : value.captions,
            segments: value.segments.map((segment) => segment.id === partial.segmentId ? { ...segment, status: partial.status, error: partial.error || "", windowIndex: partial.windowIndex || 0, totalWindows: partial.totalWindows || 0 } : segment),
          }));
        },
      });
      const completedSegments = segments.map((segment) => ({
        ...segment,
        status: captions.some((caption) => caption.visualSegmentId === segment.id) ? "done" : "empty",
      }));
      await capabilitySession?.complete({
        durationSeconds: getVisualSegmentsTotal(visualSegments),
        candidates,
        captions,
        segments: completedSegments,
      });
      if (!captions.length) {
        setJob({ running: false, progress: 100, phase: t("autoEditNoResults") });
        return;
      }
      setReview((value) => ({ ...value, captions }));
      setJob({ running: false, progress: 100, phase: t("autoEditDone") });
    } catch (error) {
      if (!abortRef.current?.signal.aborted) abortRef.current?.abort(error);
      await capabilitySession?.fail(error).catch(() => undefined);
      if (error?.name !== "AbortError") setReview((value) => ({ ...value, error: error?.message || String(error) }));
      setJob({ running: false, progress: 0, phase: "" });
    } finally {
      const [createdSession, createdTranslator] = await Promise.all([
        session || sessionPromise.catch(() => null),
        translator || translatorPromise.catch(() => null),
      ]);
      createdSession?.destroy?.();
      createdTranslator?.destroy?.();
    }
  }, [capabilityRuntime, checkSupport, clearCandidateUrls, job.running, language, notify, support, t, visualSegments]);
  const cancel = () => { abortRef.current?.abort(); setJob({ running: false, progress: 0, phase: "" }); };
  const closeReview = () => {
    if (job.running) abortRef.current?.abort();
    setJob({ running: false, progress: 0, phase: "" });
    setReview({ open: false, candidates: [], captions: [], segments: [], error: "" });
    clearCandidateUrls();
  };
  const applyCaptions = () => {
    if (!review.captions.length) return;
    commitCaptionSegments(review.captions);
    setCaptionsEnabled(true); setSelectedTrack("caption"); setSelectedSegmentId(review.captions[0].id);
    notify(t("autoEditDone"));
    closeReview();
  };
  return { support, job, review, checkSupport, prepareSupport, run, generateImageCaption, cancel, closeReview, applyCaptions };
}
