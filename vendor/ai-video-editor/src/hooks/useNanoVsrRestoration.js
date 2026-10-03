import { useEffect, useRef, useState } from "react";

import { restoreNanoVsrImage, restoreNanoVsrVideo } from "../lib/nanovsr.js";
import { startRestorationCapability } from "../lib/restorationCapability.js";

import { withHostIdentity } from "../lib/hostAuthorizedMedia.js";
function makeName(segment) {
  const base = String(segment?.name || segment?.type || "media").replace(/\.[^.]+$/, "");
  return `${base}-nanovsr-4x.${segment?.type === "video" ? "mp4" : "png"}`;
}

const EMPTY_JOB = {
  running: false,
  progress: 0,
  phaseKey: "",
  frameIndex: 0,
  totalFrames: 0,
  backend: "",
};

export function useNanoVsrRestoration({
  selectedSegment,
  imageUrlRefs,
  setVisualSegments,
  setUserAssets,
  notify,
  t,
  capabilityRuntime,
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [job, setJob] = useState(EMPTY_JOB);
  const resultRef = useRef(null);
  const controllerRef = useRef(null);
  const capabilitySessionRef = useRef(null);
  const applyInFlightRef = useRef(false);
  const savedEnhancement = selectedSegment?.enhancement?.mode === "nanovsr-644k"
    ? selectedSegment.enhancement
    : null;
  const sourceSegment = savedEnhancement?.original?.src
    ? { ...selectedSegment, ...savedEnhancement.original, type: selectedSegment.type, name: selectedSegment.name }
    : selectedSegment;

  const clearResult = () => {
    if (resultRef.current?.ownedUrl && resultRef.current.url) URL.revokeObjectURL(resultRef.current.url);
    resultRef.current = null;
    setResult(null);
  };

  useEffect(() => {
    controllerRef.current?.abort();
    void capabilitySessionRef.current?.cancel();
    capabilitySessionRef.current = null;
    setDialogOpen(false);
    clearResult();
    setJob(EMPTY_JOB);
  }, [selectedSegment?.id]);

  useEffect(() => () => {
    controllerRef.current?.abort();
    void capabilitySessionRef.current?.cancel();
    if (resultRef.current?.ownedUrl && resultRef.current.url) URL.revokeObjectURL(resultRef.current.url);
  }, []);

  const openDialog = () => {
    if (!selectedSegment || !["image", "video"].includes(selectedSegment.type)) {
      notify(t("hdRestoreSelectMedia"));
      return;
    }
    if (!resultRef.current && savedEnhancement?.processed?.src) {
      const ownedUrl = savedEnhancement.processed.blob instanceof Blob;
      const url = ownedUrl ? URL.createObjectURL(savedEnhancement.processed.blob) : savedEnhancement.processed.src;
      const savedResult = {
        ...savedEnhancement.processed,
        blob: savedEnhancement.processed.blob,
        url,
        ownedUrl,
        type: selectedSegment.type,
        backend: savedEnhancement.backend || "webgpu",
        frameRate: savedEnhancement.frameRate,
        totalFrames: savedEnhancement.totalFrames,
      };
      resultRef.current = savedResult;
      setResult(savedResult);
    }
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (!job.running && !job.applying) {
      void capabilitySessionRef.current?.cancel();
      capabilitySessionRef.current = null;
      clearResult();
      setDialogOpen(false);
    }
  };

  const run = async () => {
    if (!selectedSegment || job.running) return false;
    await capabilitySessionRef.current?.cancel();
    capabilitySessionRef.current = null;
    clearResult();
    const controller = new AbortController();
    controllerRef.current = controller;
    setJob({ ...EMPTY_JOB, running: true, progress: 1, phaseKey: "hdRestorePhasePrepare", startedAt: Date.now() });
    let capabilitySession = null;
    try {
      capabilitySession = await startRestorationCapability({
        capabilityRuntime,
        outputKind: selectedSegment.type,
        title: makeName(selectedSegment),
        signal: controller.signal,
      });
      capabilitySessionRef.current = capabilitySession;
      capabilitySession?.signal.addEventListener("abort", () => {
        if (capabilitySessionRef.current !== capabilitySession) return;
        const notifyAfterPreview = controllerRef.current === null && !applyInFlightRef.current;
        capabilitySessionRef.current = null;
        clearResult();
        setJob((current) => ({ ...current, running: false, applying: false, progress: 0, phaseKey: "" }));
        if (notifyAfterPreview) notify(t("hdRestoreCanceled"));
      }, { once: true });
      const restore = selectedSegment.type === "video" ? restoreNanoVsrVideo : restoreNanoVsrImage;
      const nextResult = await restore({
        segment: sourceSegment,
        signal: capabilitySession?.signal || controller.signal,
        modelArtifacts: capabilitySession?.modelArtifacts,
        frameRate: 12,
        onProgress: (message) => {
          const progress = message.progress ?? Math.round((message.value || 0) * 100);
          setJob((current) => ({
            ...current,
            ...message,
            running: true,
            progress,
            backend: message.backend || current.backend || "webgpu",
          }));
          void capabilitySession?.progress({
            progress: Math.min(98, 35 + Math.round(progress * 0.63)),
            phase: message.phaseKey || "restoring",
          }).catch(() => undefined);
        },
      });
      const url = URL.createObjectURL(nextResult.blob);
      const next = { ...nextResult, url, ownedUrl: true };
      resultRef.current = next;
      setResult(next);
      setJob((current) => ({ ...current, running: false, progress: 100, phaseKey: "hdRestorePhaseReady", backend: "webgpu" }));
      await capabilitySession?.progress({ progress: 99, phase: "awaiting-apply" });
      if (capabilitySession?.signal.aborted) {
        throw capabilitySession.signal.reason || new DOMException("Canceled", "AbortError");
      }
      notify(t("hdRestorePreviewReady"));
      return true;
    } catch (error) {
      capabilitySessionRef.current = null;
      if (capabilitySession) {
        if (error?.name === "AbortError") await capabilitySession.cancel().catch(() => undefined);
        else await capabilitySession.fail(error).catch(() => undefined);
      }
      if (error?.name === "AbortError") notify(t("hdRestoreCanceled"));
      else notify(`${t("hdRestoreFailed")}：${error instanceof Error ? error.message : String(error)}`);
      setJob((current) => ({ ...current, running: false }));
      return false;
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  const apply = async () => {
    const restored = resultRef.current;
    if (!restored || !selectedSegment) return false;
    if (applyInFlightRef.current) return false;
    applyInFlightRef.current = true;
    setJob((current) => ({ ...current, applying: true, phaseKey: "repairPhaseCreateAsset" }));
    try {
      const duration = Number(selectedSegment.duration) || restored.sourceDuration || 5;
      const name = makeName(selectedSegment);
      const capabilitySession = capabilitySessionRef.current;
      if (capabilitySession) {
        try {
          const completion = await capabilitySession.complete(restored.blob, name, {
            track: "visuals",
            duration,
            replaceClipId: selectedSegment.id,
            width: restored.width,
            height: restored.height,
          });
          capabilitySessionRef.current = null;
          if (!completion?.asset) {
            throw new DOMException("Restoration task is no longer active", "AbortError");
          }
          setUserAssets((items) => [{
            id: completion.asset.versionId,
            ...withHostIdentity({}, completion.asset),
            type: selectedSegment.type,
            src: completion.asset.url,
            name: completion.asset.name,
            duration,
            width: restored.width,
            height: restored.height,
            meta: selectedSegment.type === "video"
              ? `${restored.width}×${restored.height} · ${duration.toFixed(1)}s`
              : `${restored.width}×${restored.height}`,
            trackFrames: [],
          }, ...items]);
          notify(t("hdRestoreApplied"));
          clearResult();
          setDialogOpen(false);
          return true;
        } catch (error) {
          capabilitySessionRef.current = null;
          if (error?.name === "AbortError") notify(t("hdRestoreCanceled"));
          else notify(`${t("hdRestoreFailed")}：${error instanceof Error ? error.message : String(error)}`);
          return false;
        }
      }
      if (capabilityRuntime) {
        notify(`${t("hdRestoreFailed")}：restoration task is no longer active; run the restoration again`);
        return false;
      }
      const url = URL.createObjectURL(restored.blob);
      imageUrlRefs.current.add(url);
      const isVideo = selectedSegment.type === "video";
      const asset = {
        id: `nanovsr-${crypto.randomUUID?.() ?? Date.now()}`,
        type: selectedSegment.type,
        src: url,
        blob: restored.blob,
        name: makeName(selectedSegment),
        duration,
        width: restored.width,
        height: restored.height,
        meta: isVideo
          ? `${restored.width}×${restored.height} · ${(Number(selectedSegment.duration) || restored.sourceDuration || 0).toFixed(1)}s`
          : `${restored.width}×${restored.height}`,
        trackFrames: [],
      };
      setUserAssets((items) => [asset, ...items]);
      setVisualSegments((items) => items.map((item) => {
        if (item.id !== selectedSegment.id) return item;
        const original = item.enhancement?.original || {
          src: item.src,
          blob: item.blob,
          width: item.width,
          height: item.height,
          sourceStart: item.sourceStart,
          sourceDuration: item.sourceDuration,
          trackFrames: item.trackFrames || [],
        };
        const processed = {
          src: url,
          blob: restored.blob,
          width: restored.width,
          height: restored.height,
          sourceStart: 0,
          sourceDuration: restored.sourceDuration || item.sourceDuration,
          trackFrames: [],
        };
        return {
          ...item,
          ...processed,
          enhancement: {
            mode: "nanovsr-644k",
            enabled: true,
            original,
            processed,
            backend: restored.backend || "webgpu",
            frameRate: restored.frameRate,
            totalFrames: restored.totalFrames,
          },
        };
      }));
      notify(t("hdRestoreApplied"));
      clearResult();
      setDialogOpen(false);
      return true;
    } finally {
      applyInFlightRef.current = false;
      setJob((current) => ({ ...current, applying: false }));
    }
  };

  const cancel = () => {
    if (!controllerRef.current) return;
    setJob((current) => ({ ...current, phaseKey: "hdRestorePhaseCanceling" }));
    controllerRef.current.abort();
  };

  return {
    dialogOpen,
    sourceSegment,
    result,
    job,
    openDialog,
    closeDialog,
    run,
    apply,
    cancel,
    clearResult,
  };
}
