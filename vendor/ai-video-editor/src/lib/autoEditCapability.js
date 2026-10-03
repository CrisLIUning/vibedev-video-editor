function requestId() {
  return globalThis.crypto?.randomUUID?.() ?? `auto-edit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function compactText(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function documentResult(review, language, segmentCount) {
  const candidates = (review.candidates || []).slice(0, 120).map((candidate) => ({
    segmentId: compactText(candidate.segmentId, 120),
    time: Math.max(0, Number(candidate.time) || 0),
    difference: Math.max(0, Number(candidate.difference) || 0),
    aspectRatio: compactText(candidate.aspectRatio, 24),
  }));
  const captions = (review.captions || []).slice(0, 500).map((caption) => ({
    id: compactText(caption.id, 120),
    text: compactText(caption.text),
    start: Math.max(0, Number(caption.start) || 0),
    end: Math.max(0, Number(caption.end) || 0),
    visualSegmentId: compactText(caption.visualSegmentId, 120),
  }));
  const segments = (review.segments || []).slice(0, 128).map((segment) => ({
    id: compactText(segment.id, 120),
    index: Math.max(0, Number(segment.index) || 0),
    status: compactText(segment.status, 32),
    error: compactText(segment.error),
  }));
  const denominator = Math.max(1, Number(segmentCount) || segments.length || 1);
  const completedSegments = segments.filter((segment) => segment.status === "done").length;
  const captionSegmentIds = new Set(captions.map((caption) => caption.visualSegmentId).filter(Boolean));
  const evidenceSegmentIds = new Set(candidates.map((candidate) => candidate.segmentId).filter(Boolean));
  const dimensions = {
    segmentCoverage: Math.min(1, completedSegments / denominator),
    captionCoverage: Math.min(1, captionSegmentIds.size / denominator),
    evidenceCoverage: Math.min(1, evidenceSegmentIds.size / denominator),
  };
  const score = Math.floor((dimensions.segmentCoverage + dimensions.captionCoverage + dimensions.evidenceCoverage) / 3 * 100);
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  return {
    kind: "auto-edit-review",
    schemaVersion: 1,
    algorithm: "fork-first",
    language,
    durationSeconds: Math.max(0, Number(review.durationSeconds) || 0),
    segmentCount,
    candidateCount: candidates.length,
    captionCount: captions.length,
    candidates,
    captions,
    segments,
    qualityScore: { score, grade, dimensions },
  };
}

export async function startAutoEditCapability({ capabilityRuntime, language, segmentCount, signal }) {
  if (!capabilityRuntime) return null;
  const request = {
    schemaVersion: 1,
    requestId: requestId(),
    capability: "auto-edit",
    title: "智能自动剪辑",
    parameters: { language, segmentCount, algorithm: "fork-first" },
  };
  const task = await capabilityRuntime.start(request);
  const combined = new AbortController();
  let settled = false;
  function cleanup() {
    task.signal.removeEventListener("abort", abortFromHost);
    signal?.removeEventListener("abort", abortFromEditor);
  }
  function abortFromHost() {
    settled = true;
    cleanup();
    combined.abort(task.signal.reason || new DOMException("Canceled", "AbortError"));
  }
  function abortFromEditor() {
    settled = true;
    cleanup();
    combined.abort(signal?.reason || new DOMException("Canceled", "AbortError"));
    void capabilityRuntime.cancel(task.taskId).catch(() => undefined);
  }
  task.signal.addEventListener("abort", abortFromHost, { once: true });
  signal?.addEventListener("abort", abortFromEditor, { once: true });
  if (task.signal.aborted) abortFromHost();
  if (signal?.aborted) abortFromEditor();
  return {
    signal: combined.signal,
    async progress(update) {
      if (settled || combined.signal.aborted) return;
      await capabilityRuntime.progress(task.taskId, update);
    },
    async complete(review) {
      if (combined.signal.aborted) throw combined.signal.reason || new DOMException("Canceled", "AbortError");
      if (settled) return null;
      settled = true;
      cleanup();
      return capabilityRuntime.complete(task.taskId, request, {
        documentResult: documentResult(review, language, segmentCount),
      });
    },
    async fail(error) {
      if (settled || combined.signal.aborted) return;
      settled = true;
      cleanup();
      await capabilityRuntime.fail(task.taskId, {
        code: "VIDEO_EDITOR_AUTO_EDIT_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    },
    async cancel() {
      if (settled) return;
      settled = true;
      cleanup();
      combined.abort(new DOMException("Canceled", "AbortError"));
      await capabilityRuntime.cancel(task.taskId);
    },
  };
}
