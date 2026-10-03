function positive(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export async function createDepthCapabilityOutput({ analysis, source, model, encodeFrames, signal }) {
  if (!source?.assetId || !source?.versionId || !source?.clipId) throw new Error("Depth analysis requires a pinned source AssetVersion and clip");
  if (!model?.id || !model?.revision) throw new Error("Depth analysis requires a pinned model revision");
  const samples = Array.isArray(analysis?.samples)
    ? analysis.samples.filter((sample) => sample?.depthBlob instanceof Blob)
    : [];
  if (!samples.length) throw new Error("Depth analysis did not produce persistent depth maps");
  const width = Math.round(positive(samples[0]?.width, positive(analysis?.sourceSize?.width)));
  const height = Math.round(positive(samples[0]?.height, positive(analysis?.sourceSize?.height)));
  if (!width || !height) throw new Error("Depth analysis did not report dimensions");
  const duration = positive(analysis?.duration, positive(source.sourceDuration));
  const fps = source.mediaType === "video" ? positive(analysis?.fps, 8) : 1;
  const analysisId = crypto.randomUUID();
  const times = samples.map((sample) => Math.max(0, Number(sample.time) || 0));
  const blob = source.mediaType === "video"
    ? await encodeFrames(samples.map((sample) => sample.depthBlob), width, height, fps, times, duration, { signal })
    : samples[0].depthBlob;
  return {
    files: [{
      blob,
      fileName: `depth-map-${analysisId}.${source.mediaType === "video" ? "webm" : "png"}`,
      mimeType: source.mediaType === "video" ? "video/webm" : "image/png",
      title: "Depth analysis",
      analysisRole: "depth-map",
    }],
    analysisResult: {
      analysisId,
      analysisKind: "depth",
      source: {
        assetId: source.assetId, versionId: source.versionId, clipId: source.clipId,
        mediaType: source.mediaType, sourceStart: Math.max(0, Number(source.sourceStart) || 0),
        sourceDuration: positive(source.sourceDuration),
      },
      model: { id: String(model.id), revision: String(model.revision) },
      width, height, frameRate: fps,
      temporalMapping: { start: 0, duration, sampleCount: samples.length },
      metadata: { complete: analysis?.complete !== false },
    },
  };
}
