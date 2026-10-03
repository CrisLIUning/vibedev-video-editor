import { useCallback, useRef } from "react";
import { DEFAULT_SCRIPT, DEFAULT_TIMELINE_DURATION_SECONDS, normalizeVoiceId, RATIO_OPTIONS, VOICES } from "../config/editor.js";
import { getAutoRatioBaselineKey } from "../lib/editorRuntime.js";
import { decodeWaveform, downloadBlob, extractAudioFromVideo } from "../lib/media.js";
import { createProjectArchive, readProjectArchive, readProjectFileAsText, resolveProjectVisualMedia } from "../lib/projectArchive.js";
import { createCaptionSegments, getImageThumbnailCount, getVisualSegmentsTotal } from "../lib/timeline.js";
import { normalizeSmartFrame } from "../lib/smartFrame.js";
import { normalizeTrackLocks, normalizeTrackVisibility } from "../lib/projectTrackState.js";
import {
  loadAuthorizedProjectMediaBlob,
  restoreAuthorizedAudioSegmentSource,
  restoreAuthorizedVisualSegmentSource,
} from "../lib/hostAuthorizedMedia.js";
import { timelineProjectFileName } from "../lib/projectFileNaming.js";

import { holdsTextEntry, selectedAudioSegmentAfterImport } from "../lib/hostImportPreservation.js";
import { createHostFieldGate } from "../lib/hostImportReconciler.js";
import {
  holdsHostSourceAudio,
  hostSourceAudioAction,
  loadHostSourceAudioBlob,
  sourceAudioIdentity,
} from "../lib/sourceAudioRestore.js";
export function useProjectFiles(deps) {
  const commandStateRef = useRef({ schemaVersion: 1, revision: 0, appliedOperationIds: [] });
  const getProjectSnapshot = useCallback(() => {
    const visualSegments = deps.visualSegments.map(({ blob, trackFrames, src, cutoutVisual, enhancement: _enhancement, ...segment }) => segment);
    const visualOverlaySegments = deps.visualOverlaySegments.map(({ blob, src, ...segment }) => segment);
    const audioSegments = deps.audioSegments.map(({ blob, url, peaks, ...segment }) => segment);
    // FORK: the music track is stripped the same way the voice track above
    // already was. `peaks` is a decoded waveform the import recomputes from
    // the blob on every load, so saving it made two costs and no gain: a cut
    // with music was written back on every open (a revision that changed
    // nothing but the peaks, spending the 50-revision history), and the cut
    // file carried the waveform for good measure.
    const musicSegments = deps.musicSegments.map(({ blob, url, peaks, ...segment }) => segment);
    return {
      script: deps.script, commandState: commandStateRef.current, selectedVoiceId: deps.selectedVoiceId, speed: deps.speed, volume: deps.volume,
      ratioId: deps.ratioId, fitMode: deps.fitMode, captionPosition: deps.captionPosition,
      captionPlacement: deps.captionPlacement, captionSize: deps.captionSize, captionStyle: deps.captionStyle,
      captionsEnabled: deps.captionsEnabled, captionSegments: deps.captionSegments, audioSegments, musicSegments, visualSegments, visualOverlaySegments,
      stickerSegments: deps.stickerSegments, selectedFilterId: deps.selectedFilterId,
      selectedTransitionId: deps.selectedTransitionId, selectedStickerId: deps.selectedStickerId,
      trackVisibility: deps.trackVisibility, trackLocks: deps.trackLocks, timelineZoom: deps.timelineZoom,
      // FORK: `audioDuration` is NOT saved from here. In this editor it is a
      // view-model value — `selectedAudioSegment?.duration` — so persisting it
      // wrote the current selection into the cut: opening a cut whose audio an
      // Agent placed saved a revision that changed nothing else, every time,
      // and clicking a different clip dirtied the document. The field itself
      // still lives in the cut, maintained by `asset.import`; the host bridge
      // carries it through a snapshot that does not mention it.
      musicName: deps.musicName, musicDuration: deps.musicDuration, musicVolume: deps.musicVolume,
      sourceAudioName: deps.sourceAudioName, sourceAudioDuration: deps.sourceAudioDuration,
      sourceAudioStart: deps.sourceAudioStart, sourceAudioVolume: deps.sourceAudioVolume,
      sourceAudioSpatialEffect: deps.sourceAudioSpatialEffect, sourceAudioSpatialAmount: deps.sourceAudioSpatialAmount,
      musicStart: deps.musicStart,
      sourceAudioAssetId: deps.sourceAudioAssetId, sourceAudioLinked: deps.sourceAudioLinked,
      // FORK: the AssetVersion the source-audio lane was cut from. Its two
      // neighbours record where their sound came from and are restored from the
      // host on import; this lane recorded a name, a length, a start and an
      // assetId — nothing the authorized list can be searched for — so a host
      // import had nothing to restore and cleared the track, and this very
      // snapshot then saved the clear over the stored cut.
      sourceAudioSource: deps.sourceAudioSource ?? null,
    };
  }, [deps]);

  const handleExportProject = useCallback(async () => {
    deps.setShowFileMenu(false);
    try {
      deps.notify("正在打包工程与媒体素材…");
      const archive = await createProjectArchive({
        project: getProjectSnapshot(), visualSegments: [...deps.visualSegments, ...deps.visualOverlaySegments],
        audioSegments: deps.audioSegments,
        audio: deps.audioBlob ? { blob: deps.audioBlob, name: "ai-voiceover" } : null,
        sourceAudio: deps.sourceAudioBlob ? { blob: deps.sourceAudioBlob, name: deps.sourceAudioName || "source-audio" } : null,
        music: deps.musicBlob ? { blob: deps.musicBlob, name: deps.musicName || "background-music" } : null,
      });
      downloadBlob(archive, timelineProjectFileName(deps.projectName));
      deps.notify("工程包已导出（含媒体素材）");
    } catch (error) { deps.notify(error instanceof Error ? `工程导出失败：${error.message}` : "工程导出失败"); }
  }, [deps, getProjectSnapshot]);

  const handleNewProject = useCallback(() => {
    if (!window.confirm("重置当前时间线将清空尚未导出的剪辑内容，是否继续？")) return;
    commandStateRef.current = { schemaVersion: 1, revision: 0, appliedOperationIds: [] };
    deps.setScript(DEFAULT_SCRIPT); deps.setCaptionSegments(createCaptionSegments(DEFAULT_SCRIPT));
    deps.setSelectedSegmentId(""); deps.clearImageTrack(""); deps.clearAudioTrack("");
    deps.setVisualOverlaySegments([]); deps.setSelectedVisualOverlayId("");
    deps.clearSourceAudioTrack(""); deps.clearMusicTrack(""); deps.setStickerSegments([]);
    deps.setSelectedStickerSegmentId(""); deps.clearAllVisionState(); deps.setCurrentTime(0);
    deps.setTimelineHorizon(DEFAULT_TIMELINE_DURATION_SECONDS); deps.setTimelineZoom(1);
    deps.setShowFileMenu(false); deps.notify("当前时间线已重置");
  }, [deps]);

  // The project payload of the last import: the base a host refresh is
  // reconciled against, so an untouched field keeps the editor's value.
  const hostProjectBaselineRef = useRef(null);
  const acceptProjectBaseline = useCallback((project) => {
    hostProjectBaselineRef.current = project;
  }, []);

  const handleImportProject = useCallback(async (file, importContext = {}) => {
    if (!file) { deps.projectFileInputRef.current?.click(); return; }
    try {
      let archive;
      try { archive = await readProjectArchive(file); }
      catch (archiveError) {
        const legacy = JSON.parse(await readProjectFileAsText(file));
        if (legacy?.format !== "timeline-studio-project" || !legacy.project) throw archiveError;
        archive = {
          payload: { ...legacy, media: { visuals: [] } },
          visualMedia: new Map(),
          audio: null,
          sourceAudio: null,
          music: null,
          legacy: importContext.hostDocument !== true,
        };
      }
      const { payload, visualMedia, audioSegmentMedia, audio, sourceAudio, music } = archive;
      const data = payload.project;
      const musicSourceUrl = typeof data.musicSourceUrl === "string" && data.musicSourceUrl
        ? data.musicSourceUrl
        : Array.isArray(data.musicSegments)
          ? data.musicSegments.find((segment) => typeof segment?.sourceUrl === "string" && segment.sourceUrl)?.sourceUrl || ""
          : "";
      commandStateRef.current = data.commandState || { schemaVersion: 1, revision: 0, appliedOperationIds: [] };
      // Apply only what the host actually changed. Everything else is the
      // person's current state and must survive a refresh they did not ask for.
      const hostChanged = createHostFieldGate(importContext, data, hostProjectBaselineRef.current);
      const hostRefresh = importContext.hostDocument === true;
      if (!hostRefresh) deps.setTimelineHorizon(DEFAULT_TIMELINE_DURATION_SECONDS);
      const nextScript = typeof data.script === "string" ? data.script : DEFAULT_SCRIPT;
      const typing = holdsTextEntry(importContext, typeof document === "undefined" ? null : document.activeElement);
      if (hostChanged("script") && !typing) deps.setScript(nextScript);
      const legacyFontId = data.captionStyle?.fontId || "default";
      let inheritedCaptionFontId = legacyFontId;
      const captions = (Array.isArray(data.captionSegments) ? data.captionSegments : createCaptionSegments(data.script || DEFAULT_SCRIPT))
        .map((segment) => {
          inheritedCaptionFontId = segment.fontId || inheritedCaptionFontId;
          return segment.fontId ? segment : { ...segment, fontId: inheritedCaptionFontId };
        });
      deps.markTimelineViewRestored?.(Boolean(captions.length || data.visualSegments?.length || data.audioSegments?.length || audio || sourceAudio || music || musicSourceUrl));
      if (hostChanged("captionSegments", "script", "captionStyle")) {
        deps.setCaptionSegments(captions);
        // Selecting a caption the person did not choose is what makes the next
        // Delete land on the wrong clip; a refresh keeps their selection.
        if (!hostRefresh) deps.setSelectedSegmentId(captions[0]?.id ?? "");
      }
      const importedVoice = VOICES.find((voice) => voice.id === normalizeVoiceId(data.selectedVoiceId)) ?? VOICES[0];
      if (hostChanged("selectedVoiceId")) deps.setSelectedVoiceId(importedVoice.id);
      if (hostChanged("speed", "selectedVoiceId")) {
        deps.setSpeed(Number.isFinite(Number(data.speed)) && Number(data.speed) > 0
          ? Number(data.speed)
          : importedVoice.defaultSpeed ?? 1);
      }
      if (hostChanged("volume")) deps.setVolume(Number.isFinite(Number(data.volume)) ? Number(data.volume) : 1);
      if (hostChanged("ratioId")) deps.setRatioId(RATIO_OPTIONS.some((option) => option.id === data.ratioId) ? data.ratioId : "16:9");
      // FORK: a loaded document's ratio is authored — by the host, the Agent
      // or the person before a reload. Prime the auto-ratio effect with the
      // media this document already has, so it only reacts to media added
      // afterwards instead of "correcting" the ratio on every open.
      if (deps.autoRatioSourceKeyRef) deps.autoRatioSourceKeyRef.current = getAutoRatioBaselineKey(data.visualSegments);
      if (hostChanged("fitMode")) deps.setFitMode(data.fitMode || "contain");
      if (hostChanged("captionPosition")) deps.setCaptionPosition(data.captionPosition || "bottom");
      if (hostChanged("captionPlacement")) deps.setCaptionPlacement(data.captionPlacement || { x: 50, y: 78 });
      if (hostChanged("captionSize")) deps.setCaptionSize(Number(data.captionSize) || 14);
      if (hostChanged("captionStyle")) deps.setCaptionStyle(data.captionStyle || deps.captionStyle);
      if (hostChanged("captionsEnabled")) deps.setCaptionsEnabled(data.captionsEnabled !== false);
      if (hostChanged("trackVisibility")) deps.setTrackVisibility(normalizeTrackVisibility(data.trackVisibility));
      if (hostChanged("trackLocks")) deps.setTrackLocks(normalizeTrackLocks(data.trackLocks));
      if (hostChanged("timelineZoom")) deps.setTimelineZoom(Number(data.timelineZoom) || 1);
      if (hostChanged("selectedFilterId")) deps.setSelectedFilterId(data.selectedFilterId || "none");
      if (hostChanged("selectedTransitionId")) deps.setSelectedTransitionId(data.selectedTransitionId || "none");
      if (hostChanged("selectedStickerId")) deps.setSelectedStickerId(data.selectedStickerId || "none");
      if (hostChanged("stickerSegments")) deps.setStickerSegments(Array.isArray(data.stickerSegments) ? data.stickerSegments : []);
      const visuals = Array.isArray(data.visualSegments) ? data.visualSegments.map((segment) => {
        const media = resolveProjectVisualMedia(visualMedia, segment);
        const restoreFromHost = importContext.hostDocument === true
          && (segment?.assetId || segment?.assetVersionId || segment?.sourceUrl);
        const restored = media?.blob
          ? { ...segment, src: URL.createObjectURL(media.blob), blob: media.blob }
          : restoreFromHost || !segment?.src
            ? restoreAuthorizedVisualSegmentSource(
                segment,
                Array.isArray(importContext.authorizedAssets) ? importContext.authorizedAssets : [],
              )
            : segment;
        if (!restored) return null;
        const smartFrame = normalizeSmartFrame(restored.smartFrame);
        if (!smartFrame) {
          const { smartFrame: _smartFrame, ...withoutSmartFrame } = restored;
          return withoutSmartFrame;
        }
        return { ...restored, smartFrame };
      }).filter(Boolean) : [];
      if (hostChanged("visualSegments")) {
        visuals.filter((segment) => segment.src?.startsWith("blob:")).forEach((segment) => deps.imageUrlRefs.current.add(segment.src));
        deps.setVisualSegments(visuals); deps.setImageDuration(getVisualSegmentsTotal(visuals));
      }
      const overlays = Array.isArray(data.visualOverlaySegments) ? data.visualOverlaySegments.map((segment) => {
        const media = resolveProjectVisualMedia(visualMedia, segment);
        const restoreFromHost = importContext.hostDocument === true
          && (segment?.assetId || segment?.assetVersionId || segment?.sourceUrl);
        return media?.blob
          ? { ...segment, src: URL.createObjectURL(media.blob), blob: media.blob }
          : restoreFromHost || !segment?.src
            ? restoreAuthorizedVisualSegmentSource(
                segment,
                Array.isArray(importContext.authorizedAssets) ? importContext.authorizedAssets : [],
              )
            : segment;
      }).filter(Boolean) : [];
      if (hostChanged("visualOverlaySegments")) {
        deps.setVisualOverlaySegments(overlays);
        if (!hostRefresh) deps.setSelectedVisualOverlayId("");
      }
      if (hostChanged("visualSegments")) {
        deps.setImageClipCount(getImageThumbnailCount(getVisualSegmentsTotal(visuals)));
        deps.setCurrentVisualAsset(visuals[0] || null);
      }
      // Every branch below revokes blob URLs and re-decodes waveforms, so a
      // refresh that did not touch the voiceover track must not enter it at all
      // — it would throw away the person's clips and re-do the work for nothing.
      const audioChanged = hostChanged("audioSegments", "audioDuration");
      if (audioChanged) deps.audioSegments.forEach((segment) => { if (segment.url?.startsWith("blob:")) URL.revokeObjectURL(segment.url); });
      if (!audioChanged) {
        // keep the voiceover track exactly as the person left it
      } else if (Array.isArray(data.audioSegments) && data.audioSegments.length) {
        let legacyDecoded = null;
        const restoredAudioSegments = (await Promise.all(data.audioSegments.map(async (segment) => {
          const blob = audioSegmentMedia?.get(segment.id)?.blob || audio;
          if (!blob) {
            return (typeof segment.sourceUrl === "string" && segment.sourceUrl)
              || segment.assetId
              || segment.assetVersionId
              ? restoreAuthorizedAudioSegmentSource(
                  segment,
                  Array.isArray(importContext.authorizedAssets) ? importContext.authorizedAssets : [],
                )
              : null;
          }
          const decoded = blob === audio
            ? (legacyDecoded ||= await decodeWaveform(blob))
            : await decodeWaveform(blob);
          return { ...segment, blob, url: URL.createObjectURL(blob), peaks: decoded.peaks };
        }))).filter(Boolean);
        deps.setAudioSegments(restoredAudioSegments);
        deps.setSelectedAudioSegmentId((previous) => selectedAudioSegmentAfterImport(
          importContext, previous, restoredAudioSegments,
        ));
      } else if (audio) {
        const decoded = await decodeWaveform(audio);
        deps.replaceAudio(audio, Number(data.audioDuration) || decoded.duration, decoded.peaks, "已恢复工程配音");
      } else {
        deps.setAudioSegments([]);
        deps.setSelectedAudioSegmentId("");
      }
      const sourceAudioChanged = hostChanged(
        "sourceAudioName", "sourceAudioDuration", "sourceAudioStart", "sourceAudioAssetId", "sourceAudioSource",
      );
      if (!sourceAudioChanged) {
        // the person's source-audio track stands
      } else {
        // FORK: a host document carries no archive media, so this branch was
        // always `clearSourceAudioTrack("")` — and `getProjectSnapshot` then
        // saved the cleared lane back through the 450ms autosave. The lane now
        // records the AssetVersion its sound was cut from and is read back from
        // it, exactly as the voice and music lanes already were.
        const heldSourceAudio = { blob: deps.sourceAudioBlob, source: deps.sourceAudioSource };
        // Re-reading the file the editor is already playing would cost a
        // download and an FFmpeg pass to arrive at the same sound.
        const restoredSourceAudio = sourceAudio || (holdsHostSourceAudio(data, heldSourceAudio)
          ? null
          : await loadHostSourceAudioBlob(
              data.sourceAudioSource,
              Array.isArray(importContext.authorizedAssets) ? importContext.authorizedAssets : [],
              { extractVideoAudio: extractAudioFromVideo },
            ));
        const sourceAudioAction = hostSourceAudioAction(data, heldSourceAudio, restoredSourceAudio, importContext);
        if (sourceAudioAction === "restore") {
          const decoded = await decodeWaveform(restoredSourceAudio);
          deps.replaceSourceAudio(restoredSourceAudio, Number(data.sourceAudioDuration) || decoded.duration, decoded.peaks, data.sourceAudioName || "source-audio", "", Number(data.sourceAudioStart) || 0, data.sourceAudioAssetId || "", { focusAudio: false, restoreExistingSettings: true, source: data.sourceAudioSource });
        } else if (sourceAudioAction === "record") {
          // No bytes and no lane held: keep the document's own record of the
          // lane rather than let the next autosave erase what it says.
          deps.setSourceAudioName?.(data.sourceAudioName || "");
          deps.setSourceAudioDuration?.(Number(data.sourceAudioDuration) || 0);
          deps.setSourceAudioStart?.(Math.max(0, Number(data.sourceAudioStart) || 0));
          deps.setSourceAudioSource?.(sourceAudioIdentity(data.sourceAudioSource));
        } else if (sourceAudioAction === "clear") deps.clearSourceAudioTrack("");
        // "keep": the lane the editor holds is the one the document names, or
        // the one the host could not supply. Either way it stays as it is.
      }
      const musicChanged = hostChanged("musicSegments", "musicName", "musicDuration", "musicStart");
      const restoredMusic = !musicChanged ? null : music || (musicSourceUrl
        ? await loadAuthorizedProjectMediaBlob(
            musicSourceUrl,
            "audio",
            Array.isArray(importContext.authorizedAssets) ? importContext.authorizedAssets : [],
          )
        : null);
      if (restoredMusic) {
        const musicIdentity = Array.isArray(data.musicSegments)
          ? data.musicSegments.find((segment) => segment?.sourceUrl === musicSourceUrl) || {}
          : {};
        const decoded = await decodeWaveform(restoredMusic);
        deps.replaceMusic(
          restoredMusic,
          Number(data.musicDuration) || decoded.duration,
          decoded.peaks,
          data.musicName || "background-music",
          "",
          {
            assetId: musicIdentity.assetId || "",
            assetVersionId: musicIdentity.assetVersionId || "",
            sourceUrl: musicSourceUrl,
            focusAudio: false,
          },
        );
        deps.setMusicStart(Math.max(0, Number(data.musicStart) || 0));
        if (Array.isArray(data.musicSegments) && data.musicSegments.length) deps.setMusicSegments(data.musicSegments.map((segment) => ({ ...segment, peaks: decoded.peaks })));
      } else if (musicChanged) {
        // Missing bytes are not an edit. Keep the serialized lane until its
        // authorized file is available; only an explicitly empty lane deletes it.
        const declaredMusic = (data.musicSegments?.length || Number(data.musicDuration) > 0 || data.musicName);
        if (declaredMusic) {
          deps.setMusicSegments((data.musicSegments || []).map((segment) => ({ ...segment })));
          deps.setMusicName?.(data.musicName || "");
          deps.setMusicDuration?.(Number(data.musicDuration) || 0);
          deps.setMusicStart?.(Math.max(0, Number(data.musicStart) || 0));
        } else deps.clearMusicTrack("");
      }
      if (hostChanged("musicVolume")) deps.setMusicVolume(Number.isFinite(Number(data.musicVolume)) ? Number(data.musicVolume) : 0.35);
      if (hostChanged("sourceAudioVolume")) deps.setSourceAudioVolume(Number.isFinite(Number(data.sourceAudioVolume)) ? Number(data.sourceAudioVolume) : 1);
      if (hostChanged("sourceAudioSpatialEffect")) deps.setSourceAudioSpatialEffect(data.sourceAudioSpatialEffect || "original");
      if (hostChanged("sourceAudioSpatialAmount")) deps.setSourceAudioSpatialAmount(Number.isFinite(Number(data.sourceAudioSpatialAmount)) ? Number(data.sourceAudioSpatialAmount) : 1);
      if (hostChanged("sourceAudioAssetId")) deps.setSourceAudioAssetId(data.sourceAudioAssetId || "");
      if (hostChanged("sourceAudioLinked")) deps.setSourceAudioLinked(data.sourceAudioLinked !== false);
      // Moving the playhead home and discarding every vision analysis are things
      // the person asked for when they opened a project, and never something a
      // background refresh should do to them.
      if (!hostRefresh) { deps.setCurrentTime(0); deps.clearAllVisionState(); }
      deps.setShowFileMenu(false);
      // Only now, with every setter applied. An import that threw halfway must
      // not leave a base claiming the editor already holds this payload.
      hostProjectBaselineRef.current = data;
      if (importContext.hostDocument !== true) {
        deps.notify(archive.legacy ? "旧版工程已导入；请重新添加未嵌入的本地媒体，然后导出为 .timeline 工程包" : "工程包已导入，媒体素材已恢复");
      }
    } catch (error) {
      deps.notify(`无法读取工程文件${error instanceof Error && error.message ? `：${error.message}` : ""}`);
      // FORK: a HOST document that fails to import must say so. Swallowing is
      // right for a file the person picked — they still have the editor they
      // had. The host's document is different: the import writes the editor's
      // tracks one after another, so a failure part-way leaves half of the
      // cut loaded, and the bridge, told nothing, marks the editor ready and
      // lets the next autosave write that half back over the stored cut.
      // Twice seen as an emptied voice/music track (2026-09-06/07). Rethrowing
      // keeps the bridge un-ready: the console shows the reason and saves
      // nothing until an import succeeds.
      if (importContext.hostDocument === true) throw error;
    }
    if (deps.projectFileInputRef.current) deps.projectFileInputRef.current.value = "";
  }, [deps]);

  return { getProjectSnapshot, handleExportProject, handleImportProject, handleNewProject, acceptProjectBaseline };
}
