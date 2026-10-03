function positive(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function requirePinnedSource(source) {
  if (!source?.assetId || !source?.versionId || !source?.clipId) {
    throw new Error("Segmentation analysis requires a pinned source AssetVersion and clip");
  }
  return {
    assetId: source.assetId,
    versionId: source.versionId,
    clipId: source.clipId,
    mediaType: source.mediaType === "video" ? "video" : "image",
    sourceStart: Math.max(0, Number(source.sourceStart) || 0),
    sourceDuration: positive(source.sourceDuration),
  };
}

function requireModel(model) {
  if (!model?.id || !model?.revision) throw new Error("Segmentation analysis requires a pinned model revision");
  return { id: String(model.id), revision: String(model.revision) };
}

function sourceSize(analysis) {
  const width = positive(analysis?.sourceSize?.width, positive(analysis?.width));
  const height = positive(analysis?.sourceSize?.height, positive(analysis?.height));
  if (!width || !height) throw new Error("Segmentation analysis did not report source dimensions");
  return { width: Math.round(width), height: Math.round(height) };
}

export async function createSegmentationCapabilityOutput({
  analysis,
  visualType,
  targetKind,
  source,
  model,
  encodeMaskVideo,
  encodeStillMask,
  signal,
}) {
  const pinnedSource = requirePinnedSource(source);
  const pinnedModel = requireModel(model);
  const dimensions = sourceSize(analysis);
  const analysisKind = targetKind === "object" ? "object" : "subject";
  const role = analysisKind === "object" ? "object-mask" : "subject-mask";
  const analysisId = crypto.randomUUID();
  const duration = positive(analysis?.duration, pinnedSource.sourceDuration);
  let blob;
  let fileName;
  let mimeType;
  let frameRate = 1;
  let sampleCount = 1;

  if (visualType === "video") {
    const samples = Array.isArray(analysis?.samples)
      ? analysis.samples.filter((sample) => sample?.cutoutBlob instanceof Blob)
      : [];
    if (!samples.length || typeof encodeMaskVideo !== "function") {
      throw new Error("Video segmentation did not produce persistent cutout frames");
    }
    const blobs = samples.map((sample) => sample.cutoutBlob);
    const times = samples.map((sample) => Math.max(0, Number(sample.time) || 0));
    frameRate = 8;
    sampleCount = samples.length;
    blob = await encodeMaskVideo(
      blobs,
      dimensions.width,
      dimensions.height,
      frameRate,
      times,
      duration,
      { signal },
    );
    fileName = `${analysisKind}-mask-${analysisId}.webm`;
    mimeType = "video/webm";
  } else {
    if (!(analysis?.cutoutBlob instanceof Blob) || analysis.cutoutBlob.size <= 0 || typeof encodeStillMask !== "function") {
      throw new Error("Image segmentation did not produce a persistent cutout");
    }
    blob = await encodeStillMask(analysis.cutoutBlob, dimensions.width, dimensions.height, { signal });
    fileName = `${analysisKind}-mask-${analysisId}.png`;
    mimeType = "image/png";
  }

  return {
    files: [{
      blob,
      fileName,
      mimeType,
      title: `${targetKind === "object" ? "Object" : "Subject"} analysis`,
      analysisRole: role,
    }],
    analysisResult: {
      analysisId,
      analysisKind,
      source: pinnedSource,
      model: pinnedModel,
      width: dimensions.width,
      height: dimensions.height,
      frameRate,
      temporalMapping: { start: 0, duration, sampleCount },
      metadata: {
        pipeline: String(analysis?.pipeline || "segmentation"),
        targetKind: targetKind === "object" ? "object" : "person",
        complete: analysis?.complete !== false,
      },
    },
  };
}
