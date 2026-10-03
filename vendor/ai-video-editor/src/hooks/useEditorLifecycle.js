import { useEffect } from "react";

import { RATIO_OPTIONS } from "../config/editor.js";
import { disposeVisionWorker } from "../lib/vision.js";
import { disposeVocalSeparationWorker } from "../lib/vocalSeparation.js";
import {
  getNearestRatioIdForSize,
  revokeVisionObjectUrls,
  getAutoRatioSourceKey,
} from "../lib/editorRuntime.js";
import { ensureUniqueVisualSegmentIds } from "../lib/timeline.js";

import { isEditorTextEntryTarget } from "../lib/editorShortcuts.js";
export function useEditorLifecycle(d) {
  useEffect(() => {
    document.documentElement.lang = d.activeLanguage === "zh" ? "zh-CN" : d.activeLanguage;
  }, [d.activeLanguage]);

  useEffect(() => () => {
    d.avatarMotionWorkerRef.current?.terminate();
    d.avatarRenderWorkerRef.current?.terminate();
  }, []);

  useEffect(() => {
    d.setFitMode("contain");
  }, [d.ratioId]);

  useEffect(() => {
    const ratioSource = d.visualSegments.find((segment) => segment.width > 0 && segment.height > 0);
    if (!ratioSource) {
      // FORK: clips not measured yet keep the baseline the import primed. A
      // cut saved before its first clip was measured otherwise lost it on
      // every load (and every undo), and the measurement then "corrected"
      // the ratio someone chose. Only an empty visual track starts over.
      if (!d.visualSegments.length) d.autoRatioSourceKeyRef.current = "";
      return;
    }
    // FORK: same key the document import primes (getAutoRatioSourceKey).
    const sourceKey = getAutoRatioSourceKey(d.visualSegments);
    if (d.autoRatioSourceKeyRef.current === sourceKey) return;
    d.autoRatioSourceKeyRef.current = sourceKey;
    const nextRatioId = getNearestRatioIdForSize(ratioSource.width, ratioSource.height);
    if (!nextRatioId || nextRatioId === d.ratioId) return;
    const nextRatio = RATIO_OPTIONS.find((option) => option.id === nextRatioId);
    d.setRatioId(nextRatioId);
    d.notify(`已根据素材自动切换为 ${nextRatio?.label ?? nextRatioId}`);
  }, [d.ratioId, d.visualSegments]);

  useEffect(() => {
    if (!d.captionSegments.length) {
      d.setSelectedSegmentId("");
      return;
    }
    if (d.selectedSegmentId && !d.captionSegments.some((segment) => segment.id === d.selectedSegmentId)) {
      d.setSelectedSegmentId(d.captionSegments[0].id);
    }
  }, [d.captionSegments, d.selectedSegmentId]);

  useEffect(() => {
    if (!d.visualSegments.length) {
      d.setSelectedVisualSegmentId("");
      return;
    }
    if (d.selectedVisualSegmentId && !d.visualSegments.some((segment) => segment.id === d.selectedVisualSegmentId)) {
      d.setSelectedVisualSegmentId(d.visualSegments[0].id);
    }
  }, [d.selectedVisualSegmentId, d.visualSegments]);

  useEffect(() => {
    const normalized = ensureUniqueVisualSegmentIds(d.visualSegments);
    if (normalized.changed) d.setVisualSegments(normalized.segments);
  }, [d.visualSegments]);

  useEffect(() => {
    if (d.currentVisualSegment?.src) d.setCurrentVisualAsset(d.currentVisualSegment);
  }, [d.currentVisualSegment]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      // Delete and Backspace destroy a clip, so this is the shortcut that must
      // be surest it is not stealing a keystroke. It hand-rolled its own focus
      // check while the rest of the editor used `isEditorTextEntryTarget`; the
      // shared one also walks ancestors and covers media controls, and being the
      // only reader of "is the person typing" keeps the two from drifting.
      //
      // `isComposing` matters just as much here: mid-IME Backspace edits the
      // composition, and an IME can put the event on the composition surface
      // rather than the field.
      if (
        event.isComposing || event.metaKey || event.ctrlKey || event.altKey ||
        isEditorTextEntryTarget(event.target) ||
        (event.key !== "Delete" && event.key !== "Backspace")
      ) return;
      const hasSelectedTimelineItem =
        (d.selectedTrack === "caption" && d.selectedSegmentId && d.captionSegments.some((segment) => segment.id === d.selectedSegmentId)) ||
        (d.selectedTrack === "sticker" && d.selectedStickerSegmentId && d.stickerSegments.some((segment) => segment.id === d.selectedStickerSegmentId)) ||
        (d.selectedTrack === "image" && d.selectedVisualSegmentId && d.visualSegments.some((segment) => segment.id === d.selectedVisualSegmentId)) ||
        (d.selectedTrack === "overlay" && d.selectedVisualOverlayId && d.visualOverlaySegments.some((segment) => segment.id === d.selectedVisualOverlayId)) ||
        (d.selectedTrack === "audio" && d.selectedAudioSegmentId && d.audioSegments.some((segment) => segment.id === d.selectedAudioSegmentId)) ||
        (d.selectedTrack === "source" && d.sourceAudioBlob) ||
        (d.selectedTrack === "music" && d.musicBlob);
      if (hasSelectedTimelineItem) {
        event.preventDefault();
        d.handleDeleteTrack();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  useEffect(() => () => {
    if (d.audioUrlRef.current) URL.revokeObjectURL(d.audioUrlRef.current);
    if (d.sourceAudioUrlRef.current) URL.revokeObjectURL(d.sourceAudioUrlRef.current);
    if (d.musicUrlRef.current) URL.revokeObjectURL(d.musicUrlRef.current);
    d.imageUrlRefs.current.forEach((url) => URL.revokeObjectURL(url));
    d.imageUrlRefs.current.clear();
    d.visionAbortControllerRef.current?.abort();
    d.visionObjectUrlsRef.current.forEach((urls) => revokeVisionObjectUrls(urls));
    d.visionObjectUrlsRef.current.clear();
    disposeVisionWorker();
    disposeVocalSeparationWorker();
    d.voiceRecorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    window.clearInterval(d.voiceRecorderTimerRef.current);
  }, []);
}
