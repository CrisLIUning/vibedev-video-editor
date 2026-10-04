import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { X } from "@phosphor-icons/react";

import { RATIO_OPTIONS } from "./config/editor.js";
import { LanguageIntro } from "./components/panels.jsx";
import { PreviewStage } from "./components/PreviewStage.jsx";
import { VoicePanel } from "./components/VoicePanel.jsx";
import { Timeline } from "./components/Timeline.jsx";
import { Topbar } from "./components/Topbar.jsx";
import { AssetDragPreview, ExportProgressOverlay } from "./components/EditorOverlays.jsx";
import { EditorSidebar } from "./components/EditorSidebar.jsx";
import { FirstVisualGuide } from "./components/FirstVisualGuide.jsx";
import { MiganRepairDialog } from "./components/MiganRepairDialog.jsx";
import { NanoVsrRestorationDialog } from "./components/NanoVsrRestorationDialog.jsx";
import {
  canShowFirstVisualGuide,
  hasSeenFirstVisualGuide,
  markFirstVisualGuideSeen,
} from "./lib/firstVisualGuide.js";
import { useExportElapsed } from "./hooks/useExportElapsed.js";
import { usePreviewFrameSize } from "./hooks/usePreviewFrameSize.js";
import { useEditorCatalog } from "./hooks/useEditorCatalog.js";
import { useToast } from "./hooks/useToast.js";
import { useProjectFiles } from "./hooks/useProjectFiles.js";
import { useAutosaveTimestamp } from "./hooks/useAutosaveTimestamp.js";
import { useVisionAnalysis } from "./hooks/useVisionAnalysis.js";
import { useSmartFrame } from "./hooks/useSmartFrame.js";
import { claimDeferredFirstVisual, useFileUpload } from "./hooks/useFileUpload.js";
import { useMediaSync } from "./hooks/useMediaSync.js";
import { useVideoExport } from "./hooks/useVideoExport.js";
import { useVoiceRecorder } from "./hooks/useVoiceRecorder.js";
import { useVoiceGeneration } from "./hooks/useVoiceGeneration.js";
import { useVoiceProfiles } from "./hooks/useVoiceProfiles.js";
import { useAutoCaptions } from "./hooks/useAutoCaptions.js";
import { useAutoEdit } from "./hooks/useAutoEdit.js";
import { useSourceAudioExtraction } from "./hooks/useSourceAudioExtraction.js";
import { useVocalSeparation } from "./hooks/useVocalSeparation.js";
import { useAvatarGeneration } from "./hooks/useAvatarGeneration.js";
import { useFaceSwapGeneration } from "./hooks/useFaceSwapGeneration.js";
import { useDepthOfFieldAnalysis } from "./hooks/useDepthOfFieldAnalysis.js";
import { useCaptionState } from "./hooks/useCaptionState.js";
import { useAudioTrackState } from "./hooks/useAudioTrackState.js";
import { useVisualTrackState } from "./hooks/useVisualTrackState.js";
import { useEditorUiState } from "./hooks/useEditorUiState.js";
import { useTimelineModel } from "./hooks/useTimelineModel.js";
import { usePreviewModel } from "./hooks/usePreviewModel.js";
import { useEditorRefs } from "./hooks/useEditorRefs.js";
import { useEditorLifecycle } from "./hooks/useEditorLifecycle.js";
import { useEditorHistory } from "./hooks/useEditorHistory.js";
import { createVisionControls } from "./lib/visionControls.js";
import { createAssetDragControls, resolveVisualDropIntent } from "./lib/assetDragControls.js";
import { createAssetLibraryActions } from "./lib/assetLibraryActions.js";
import { createPlaybackControls } from "./lib/playbackControls.js";
import { createTimelineReorderControls } from "./lib/timelineReorderControls.js";
import { createTimelineMoveControls } from "./lib/timelineMoveControls.js";
import { createImageResizeControl } from "./lib/imageResizeControl.js";
import { createTimelineClipboardActions } from "./lib/timelineClipboardActions.js";
import { appendImportedCaptions } from "./lib/subtitles.js";
import { createTimelineCutActions } from "./lib/timelineCutActions.js";
import { createTimelineSegmentCountActions } from "./lib/timelineSegmentCountActions.js";
import { createTimelineDurationActions } from "./lib/timelineDurationActions.js";
import { createAudioClipActions, updateAudioSegmentPlaybackRate } from "./lib/audioClipActions.js";
import { createCaptionEditingActions } from "./lib/captionEditingActions.js";
import { createAudioTrackActions } from "./lib/audioTrackActions.js";
import { createVisualTimelineActions } from "./lib/visualTimelineActions.js";
import { createStickerTimelineActions } from "./lib/stickerTimelineActions.js";
import { createAssetDropActions } from "./lib/assetDropActions.js";
import { createEditorCommandActions } from "./lib/editorCommandActions.js";
import { createTimelineViewModel } from "./lib/timelineViewModel.js";
import { createTranslator, getStoredLanguage, translateOptionName } from "./i18n.js";
import { decodeWaveform, downloadBlob } from "./lib/media.js";
import { useHostVisualBackfill } from "./hooks/useHostVisualBackfill.js";
import { useAiMusicGeneration } from "./hooks/useAiMusicGeneration.js";
import { useMiganRepair } from "./hooks/useMiganRepair.js";
import { useNanoVsrRestoration } from "./hooks/useNanoVsrRestoration.js";
import { getImageThumbnailCount, getVisualSegmentsTotal, normalizeTimedSegmentIds } from "./lib/timeline.js";
import { getVisualSourceTime, normalizeVisualTransform, removeVisualPropertyKeyframe, updateVisualSegmentPlaybackRate, upsertVisualKeyframe, upsertVisualPropertyKeyframe } from "./lib/visualEffects.js";
import { getVisualSpeedCurveTimelineProgress, updateVisualSegmentSpeedCurve } from "./lib/visualSpeedCurve.js";
import { getLinkedSourceAudioEnd, getLinkedSourceAudioSegments, shouldMuteEmbeddedVideoAudio, sliceSourceAudioPeaks } from "./lib/sourceAudioSync.js";
import { getTimelineInitialContentZoom } from "./lib/timelineScale.js";
import { getVisionKey } from "./lib/vision.js";
import { DEFAULT_SUBJECT_EFFECT, normalizeSubjectEffect } from "./lib/subjectEffects.js";
import { normalizeCinematicDepth, resolveDepthAnalysisAtTime } from "./lib/depthOfField.js";
import { normalizePhotoParallax } from "./lib/photoParallax.js";
import {
  getExportContentDuration,
  getExportDimensions,
  getEffectiveExportBitrate,
  loadExportSettings,
  saveExportSettings,
} from "./lib/exportSettings.js";
import { createVisualOverlaySegment, getVisualOverlayPreset, updateVisualOverlayTransform } from "./lib/visualOverlayTimeline.js";
import { getMobileClipPanelOrigin } from "./lib/mobileClipActions.js";
import { getVisualPropertyTabIds } from "./lib/visualPropertyTabs.js";
import { configureCaptionFontHostRuntime } from "./lib/captionFonts.js";
import { mergeAuthorizedUserAssets, mergeProjectFileUserAssets, adoptMeasuredDuration, withHostIdentity } from "./lib/hostAuthorizedMedia.js";
import { editorEventPathContains } from "./lib/embeddedDom.js";

export function App({ hostLibraryWorkspace = null, hostBridge = null, hostLanguage = "", hostProjectTitle = "" } = {}) {
  useEffect(() => {
    configureCaptionFontHostRuntime(hostBridge?.capabilityRuntime || null);
    return () => configureCaptionFontHostRuntime(null);
  }, [hostBridge?.capabilityRuntime]);
  const [uiLanguage, setUiLanguage] = useState(() => (
    hostLanguage ? (hostLanguage.toLowerCase().startsWith("zh") ? "zh" : "en") : getStoredLanguage()
  ));
  const [projectName, setProjectName] = useState(() => String(hostProjectTitle || "").trim());
  useEffect(() => {
    setProjectName(String(hostProjectTitle || "").trim());
  }, [hostProjectTitle]);
  const [mobilePanel, setMobilePanel] = useState("");
  const [mobilePanelClosing, setMobilePanelClosing] = useState(false);
  const mobilePanelTimerRef = useRef(null);
  const [mobilePanelOrigin, setMobilePanelOrigin] = useState("");
  const [mobileInspectorSection, setMobileInspectorSection] = useState("");
  const [effectsPanelMode, setEffectsPanelMode] = useState("outline");
  const appShellRef = useRef(null);
  const [editorViewportWidth, setEditorViewportWidth] = useState(() => (
    typeof window !== "undefined" ? window.innerWidth : 1280
  ));
  const isCompactViewport = editorViewportWidth < 1280;
  const isMobileViewport = editorViewportWidth <= 760;
  const isNarrowMobileViewport = editorViewportWidth <= 390;
  useEffect(() => {
    const shell = appShellRef.current;
    if (!shell || typeof ResizeObserver === "undefined") return undefined;
    const update = (width) => {
      if (width > 0) setEditorViewportWidth(width);
    };
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width ?? shell.getBoundingClientRect().width;
      update(width);
    });
    observer.observe(shell);
    update(shell.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportSettings, setExportSettings] = useState(() => loadExportSettings());
  useEffect(() => {
    saveExportSettings(exportSettings);
  }, [exportSettings]);
  const [captionVoiceFocusRequest, setCaptionVoiceFocusRequest] = useState(0);
  const [selectedSourceAudioSegmentId, setSelectedSourceAudioSegmentId] = useState("");
  const [selectedMusicSegmentId, setSelectedMusicSegmentId] = useState("");
  const [stickerTimelineDrag, setStickerTimelineDrag] = useState(null);
  const [canvasVisualTarget, setCanvasVisualTarget] = useState("");
  const [showFirstVisualGuide, setShowFirstVisualGuide] = useState(false);
  const firstVisualGuideShownRef = useRef(false);
  const timelineImportRestoreRef = useRef(false);
  const hostImportInProgressRef = useRef(false);
  const changeMobilePanel = (nextPanel) => {
    if (mobilePanelTimerRef.current) window.clearTimeout(mobilePanelTimerRef.current);
    if (!nextPanel && mobilePanel) {
      setMobilePanelClosing(true);
      mobilePanelTimerRef.current = window.setTimeout(() => {
        setMobilePanel("");
        setMobilePanelClosing(false);
        setMobilePanelOrigin("");
        setMobileInspectorSection("");
        mobilePanelTimerRef.current = null;
      }, 170);
      return;
    }
    setMobilePanelClosing(false);
    setMobilePanel(nextPanel);
  };
  const [introClosing, setIntroClosing] = useState(false);
  const {
    captionPlacement, captionPosition, captionSegments, captionSize, captionStyle,
    captionsEnabled, script, selectedSegmentId, setCaptionPlacement,
    setCaptionPosition, setCaptionSegments, setCaptionSize, setCaptionStyle,
    setCaptionsEnabled, setScript, setSelectedSegmentId,
  } = useCaptionState();
  const {
    audioSegments, audioSegmentsRef, favoriteVoiceIds, generatedVoiceEndRef, historyItems, musicBlob, musicDuration, musicName, musicSegments, musicStart,
    musicPeaks, musicUrl, musicVolume, recordedVoices, recordingElapsed, recordingState,
    selectedAudioSegmentId, selectedVoiceId, setAudioSegments, setFavoriteVoiceIds,
    setHistoryItems, setMusicBlob, setMusicDuration, setMusicName, setMusicPeaks, setMusicStart,
    setMusicSegments, setMusicUrl, setMusicVolume, setRecordedVoices, setRecordingElapsed,
    setRecordingState, setSelectedAudioSegmentId, setSelectedVoiceId, setSourceAudioBlob,
    setSourceAudioAssetId, setSourceAudioDuration, setSourceAudioLinked, setSourceAudioName, setSourceAudioPeaks, setSourceAudioStart,
    setSourceAudioUrl, setSourceAudioVolume, setSourceAudioSpatialEffect, setSourceAudioSpatialAmount, setSpeed, setTimelineHorizon, setVolume,
    // FORK: the AssetVersion the source-audio lane was cut from, so a host
    // import can read the lane back instead of clearing it.
    setSourceAudioSource, sourceAudioSource,
    sourceAudioAssetId, sourceAudioBlob, sourceAudioDuration, sourceAudioLinked, sourceAudioName, sourceAudioPeaks,
    sourceAudioStart, sourceAudioUrl, sourceAudioVolume, sourceAudioSpatialEffect, sourceAudioSpatialAmount, speed, timelineHorizon, volume,
  } = useAudioTrackState();
  const {
    fitMode, imageClipCount, imageDuration, imageMeta, imageName, imageSrc,
    selectedFilterId, selectedStickerId, selectedStickerSegmentId, selectedTransitionId,
    selectedVisualSegmentId, setFitMode, setImageClipCount, setImageDuration, setImageMeta,
    setImageName, setImageSrc, setSelectedFilterId, setSelectedStickerId,
    setSelectedStickerSegmentId, setSelectedTransitionId, setSelectedVisualSegmentId,
    setStickerSegments, setVisualSegments, setVisualType, stickerSegments, visualSegments,
    visualType, visualOverlaySegments, selectedVisualOverlayId,
    setVisualOverlaySegments, setSelectedVisualOverlayId,
  } = useVisualTrackState();
  // A clip an agent or a capability placed carries no dimensions and no frame
  // strip — nothing has decoded its media. Measure it, or the timeline shows
  // frame 0 across the whole clip and smart framing sees a zero-size source.
  useHostVisualBackfill({ visualSegments, setVisualSegments });
  const {
    activeTool, assetDragPreview, assetDropPosition, assetDropPulseTrack,
    assetDropTargetTrack, compactRail, currentTime, draggedAssetId, exporting, exportPhase,
    exportProgress, isDragging, isPlaying, mediaTab, progress, ratioId,
    selectedLibraryAssetId, selectedTrack, setActiveTool, setAssetDragPreview,
    setAssetDropPosition, setAssetDropPulseTrack, setAssetDropTargetTrack, setCompactRail,
    setCurrentTime, setDraggedAssetId, setExporting, setExportPhase, setExportProgress,
    setIsDragging, setIsPlaying, setMediaTab, setProgress, setRatioId,
    setSelectedLibraryAssetId, setSelectedTrack, setShowFileMenu, setShowRatioMenu,
    setShowSettings, setShowVoiceFilter, setSnapGuide, setStatus, setStatusText,
    setTimelineClipDrag, setTimelineZoom, setTrackLocks, setTrackVisibility, setVoiceFilter,
    setVoiceTab, showFileMenu, showRatioMenu, showSettings, showVoiceFilter, snapGuide,
    status, statusText, timelineClipDrag, timelineZoom, trackLocks, trackVisibility,
    voiceFilter, voiceTab,
  } = useEditorUiState();
  const [userAssets, setUserAssets] = useState([]);
  // FORK: the host's authorized list, as the host gave it. `userAssets` is the
  // merged library VIEW of it; reading a clip's file back needs the list —
  // which AssetVersion, at which URL, of which kind. Held in a ref because the
  // bridge connects once and the export reads it long after.
  const hostAuthorizedAssetsRef = useRef([]);
  const userAssetsRef = useRef(userAssets);
  const visualSegmentsRef = useRef(visualSegments);
  const firstVisualAutoAddClaimRef = useRef("");
  userAssetsRef.current = userAssets;
  visualSegmentsRef.current = visualSegments;
  useEffect(() => {
    if (visualSegments.length) firstVisualAutoAddClaimRef.current = "";
  }, [visualSegments.length]);
  const claimFirstVisualAutoAdd = useCallback((localAssetId) => claimDeferredFirstVisual(
    firstVisualAutoAddClaimRef,
    localAssetId,
    visualSegmentsRef.current,
    userAssetsRef.current,
  ), []);
  const applyPinnedAssetIdentity = useCallback((localAssetId, pinned) => {
    if (!localAssetId || !pinned?.assetId || !pinned?.versionId) return;
    const patch = {
      ...withHostIdentity({}, pinned),
      sourceUrl: pinned.url,
      src: pinned.url,
      requiresPin: false,
      hostAuthorized: true,
    };
    const replaceIdentity = (item) => (
      item?.id === localAssetId || item?.assetId === localAssetId || item?.localAssetId === localAssetId
        ? { ...item, ...patch, localAssetId }
        : item
    );
    setUserAssets((items) => items
      .filter((item) => item?.id === localAssetId || (item?.assetVersionId || item?.versionId) !== pinned.versionId)
      .map((item) => {
        const next = replaceIdentity(item);
        return next === item ? item : { ...next, ...adoptMeasuredDuration(item, pinned.durationSeconds) };
      }));
    setVisualSegments((items) => items.map(replaceIdentity));
    setVisualOverlaySegments((items) => items.map(replaceIdentity));
    setAudioSegments((items) => items.map(replaceIdentity));
    setMusicSegments((items) => items.map(replaceIdentity));
    setStickerSegments((items) => items.map(replaceIdentity));
  }, [setAudioSegments, setMusicSegments, setStickerSegments, setVisualOverlaySegments, setVisualSegments]);
  const { notify, toast } = useToast(2600, uiLanguage || "zh");
  const [previewVideoMediaTime, setPreviewVideoMediaTime] = useState(0);
  const [sourceAudioDragTargetLane, setSourceAudioDragTargetLane] = useState(null);
  const sourceVoiceColorOriginalRef = useRef(null);
  const [visionRecords, setVisionRecords] = useState({});
  const [depthRecords, setDepthRecords] = useState({});
  const [visionJob, setVisionJob] = useState({
    running: false,
    key: "",
    progress: 0,
    phase: "",
  });
  const [avatarPanelOpen, setAvatarPanelOpen] = useState(false);
  const [smartMode, setSmartMode] = useState("auto-edit");
  const [avatarJob, setAvatarJob] = useState({ running: false, progress: 0, phase: "" });
  const { label: lastSaved, revision: autosaveRevision } = useAutosaveTimestamp([
    script, imageSrc, visualType, imageDuration, captionPlacement, captionPosition, captionSize, captionStyle, captionsEnabled, selectedVoiceId, speed,
    volume, musicName, musicDuration, musicStart, musicVolume, sourceAudioName, sourceAudioDuration,
    sourceAudioStart, sourceAudioVolume, sourceAudioSpatialEffect, sourceAudioSpatialAmount, ratioId, fitMode, selectedFilterId, selectedStickerId,
    captionSegments, audioSegments, musicSegments, stickerSegments,
    visualSegments, visualOverlaySegments, timelineZoom, selectedTransitionId, trackVisibility, trackLocks,
    sourceAudioAssetId, sourceAudioLinked, sourceAudioSource,
  ]);

  const {
    assetDropPulseTimerRef, audioRef, audioSegmentRefs, audioUrlRef, autoRatioSourceKeyRef,
    avatarMotionCacheRef, avatarMotionWorkerRef, avatarRenderWorkerRef,
    currentTimeRef, draggedAssetIdRef,
    exportAbortControllerRef, exportStartRef, fileInputRef, imageUrlRefs, musicRef, musicUrlRef, pointerAssetDragRef,
    previewCanvasRef, previewShellRef, previewVideoRef, projectFileInputRef, sourceAudioRef,
    sourceAudioUrlRef, suppressAssetClickRef, suppressTimelineClipClickRef,
    timelineClipDragRef, timelineDurationRef, trackScrollRef, visionAbortControllerRef,
    visionJobGenerationRef, visionObjectUrlsRef, visualPlaybackFrameRef,
    visualPlaybackLastUpdateRef, visualPlaybackStartedAtRef, visualPlaybackStartTimeRef,
    voiceRecorderChunksRef, voiceRecorderRef, voiceRecorderStartedAtRef,
    voiceRecorderStreamRef, voiceRecorderTimerRef,
  } = useEditorRefs();
  const activeLanguage = uiLanguage || "zh";
  const aiMusic = useAiMusicGeneration({
    activeLanguage,
    imageUrlRefs,
    setActiveTool,
    setMediaTab,
    setSelectedLibraryAssetId,
    setUserAssets,
    capabilityRuntime: hostBridge?.capabilityRuntime,
  });
  const { redo: localRedo, undo: localUndo } = useEditorHistory({
    disableKeyboardHistory: Boolean(hostBridge),
    audioSegments, captionPlacement, captionPosition, captionSegments, captionSize,
    captionStyle, captionsEnabled, currentTime, fitMode, imageClipCount, imageDuration,
    imageMeta, imageName, imageSrc, imageUrlRefs, musicBlob, musicDuration, musicName, musicStart,
    musicPeaks, musicUrl, musicUrlRef, musicVolume, notify, selectedAudioSegmentId,
    selectedFilterId, selectedSegmentId, selectedStickerId, selectedStickerSegmentId,
    selectedTrack, selectedTransitionId, selectedVisualSegmentId, script, setAudioSegments,
    setCaptionPlacement, setCaptionPosition, setCaptionSegments, setCaptionSize,
    setCaptionStyle, setCaptionsEnabled, setCurrentTime, setFitMode, setImageClipCount,
    setImageDuration, setImageMeta, setImageName, setImageSrc, setIsPlaying, setMusicBlob,
    setMusicDuration, setMusicName, setMusicPeaks, setMusicStart, setMusicUrl, setMusicVolume, setScript,
    setSelectedAudioSegmentId, setSelectedFilterId, setSelectedSegmentId,
    setSelectedStickerId, setSelectedStickerSegmentId, setSelectedTrack,
    setSelectedTransitionId, setSelectedVisualSegmentId, setSourceAudioBlob,
    setSourceAudioAssetId, setSourceAudioDuration, setSourceAudioLinked, setSourceAudioName, setSourceAudioPeaks, setSourceAudioStart,
    // FORK: `replaceSourceAudio` / `clearSourceAudioTrack` record and drop the
    // lane's host origin through this setter.
    setSourceAudioSource,
    setSourceAudioUrl, setSourceAudioVolume, setStickerSegments, setTimelineHorizon,
    setTrackLocks, setTrackVisibility, setUserAssets, setVisualSegments, setVisualType,
    sourceAudioAssetId, sourceAudioBlob, sourceAudioDuration, sourceAudioLinked, sourceAudioName, sourceAudioPeaks,
    sourceAudioStart, sourceAudioUrl, sourceAudioUrlRef, sourceAudioVolume, stickerSegments,
    timelineHorizon, trackLocks, trackVisibility, userAssets, visualSegments, visualType,
    visualOverlaySegments, selectedVisualOverlayId, setVisualOverlaySegments, setSelectedVisualOverlayId,
  });
  const undo = useCallback(() => {
    if (hostBridge) return hostBridge.requestHistoryMove("undo");
    return localUndo();
  }, [hostBridge, localUndo]);
  const redo = useCallback(() => {
    if (hostBridge) return hostBridge.requestHistoryMove("redo");
    return localRedo();
  }, [hostBridge, localRedo]);
  useEffect(() => {
    if (!hostBridge) return undefined;
    const handleHistoryShortcut = (event) => {
      const target = event.target;
      const isTyping = target instanceof HTMLElement && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      );
      if (isTyping || (!event.metaKey && !event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [hostBridge, redo, undo]);
  const t = useMemo(() => createTranslator(activeLanguage), [activeLanguage]);
  const {
    addVoiceProfile, removeVoiceProfile, selectedVoiceProfileId, setSelectedVoiceProfileId,
    toggleVoiceProfileFavorite, voiceProfiles,
  } = useVoiceProfiles({ favoriteVoiceIds, setFavoriteVoiceIds, notify, t });
  const selectedVoiceProfile = voiceProfiles.find((profile) => profile.id === selectedVoiceProfileId) ?? null;
  const handleCancelExport = () => {
    const controller = exportAbortControllerRef.current;
    if (!controller || controller.signal.aborted) return;
    setExportPhase(t("exportCanceling"));
    controller.abort();
  };
  const trOption = (name, option) => {
    if (option?.kind === "stickerCategory") {
      return activeLanguage !== "zh" && option.nameEn ? option.nameEn : name;
    }

    return activeLanguage !== "zh" && option?.nameEn ? option.nameEn : translateOptionName(activeLanguage, name);
  };
  const shouldShowLanguageIntro = !uiLanguage;
  const requestFirstVisualGuide = () => {
    if (!canShowFirstVisualGuide({
      isMobile: isMobileViewport,
      hasSeen: hasSeenFirstVisualGuide(),
      shownThisSession: firstVisualGuideShownRef.current,
    })) return;
    firstVisualGuideShownRef.current = true;
    setShowFirstVisualGuide(true);
  };

  const linkedSourceAudioSegments = useMemo(
    () => sourceAudioLinked && sourceAudioBlob
      ? getLinkedSourceAudioSegments(visualSegments, sourceAudioAssetId, sourceAudioDuration)
      : [],
    [sourceAudioAssetId, sourceAudioBlob, sourceAudioDuration, sourceAudioLinked, visualSegments],
  );
  const sourceAudioTimelineEnd = sourceAudioLinked && linkedSourceAudioSegments.length
    ? getLinkedSourceAudioEnd(linkedSourceAudioSegments)
    : sourceAudioStart + sourceAudioDuration;
  const musicTimelineEnd = musicSegments.length
    ? musicSegments.reduce((end, segment) => Math.max(end, segment.start + segment.duration), 0)
    : musicStart + musicDuration;

  const {
    activePreviewFilter, audioBlob, audioDuration, audioUrl, canPreview, captionDuration,
    captionTargetDuration, captionTimeline, currentCaption, currentCaptions, currentCaptionSegment,
    currentSegmentIndex, currentStickerSegment, currentStickerSegmentIndex,
    currentVisualRange, currentVisualSegment, currentVisualSegmentIndex, estimatedDuration,
    focusedSegmentIndex, getStickerDragAsset, peaks, previewSticker, previewStickers, previewVisualOverlays, previewTransition,
    previewVisionBaseAnalysis, previewVisionKey, previewVisionRecord, previewVisualLocalTime,
    previewVisualRange, previewVisualSegment, previewVisualSegmentIndex,
    previewVisualSourceTime, previewVisualSrc, previewVisualType, ratio, segments,
    selectedAudioSegment, selectedCaptionSegment, selectedFilter, selectedSegmentIndex,
    selectedSticker, selectedStickerSegmentIndex, selectedVisualSegmentIndex, selectedVoice,
    stickerDuration, timelineDuration, visualTimeline, voiceTrackDuration,
  } = useTimelineModel({
    audioSegments, captionSegments, currentTime, imageDuration, imageSrc, musicBlob,
    musicDuration, musicTimelineEnd, musicUrl, ratioId, script, selectedAudioSegmentId, selectedFilterId,
    selectedSegmentId, selectedStickerId, selectedStickerSegmentId,
    selectedVisualSegmentId, selectedVoiceId, sourceAudioBlob, sourceAudioDuration,
    sourceAudioTimelineEnd,
    sourceAudioStart, sourceAudioUrl, stickerSegments, timelineDurationRef, timelineHorizon,
    timelineZoom,
    trackVisibility, visionRecords, visualSegments, visualType, visualOverlaySegments,
  });
  const previousTimelineContentDurationRef = useRef(estimatedDuration);
  useEffect(() => {
    // Restoring history is not adding/removing content. Auto-fit during that
    // restoration would itself become a new save and destroy the redo branch.
    if (hostImportInProgressRef.current) {
      previousTimelineContentDurationRef.current = estimatedDuration;
      return;
    }
    const previousDuration = previousTimelineContentDurationRef.current;
    const becameNonEmpty = previousDuration <= 0 && estimatedDuration > 0;
    const becameEmpty = previousDuration > 0 && estimatedDuration <= 0;

    if (becameNonEmpty) {
      if (timelineImportRestoreRef.current) timelineImportRestoreRef.current = false;
      else setTimelineZoom(getTimelineInitialContentZoom(estimatedDuration));
      if (trackScrollRef.current) trackScrollRef.current.scrollLeft = 0;
    } else if (becameEmpty) {
      timelineImportRestoreRef.current = false;
      setTimelineHorizon(10);
      setTimelineZoom(getTimelineInitialContentZoom(0));
      setCurrentTime(0);
      if (trackScrollRef.current) trackScrollRef.current.scrollLeft = 0;
    }

    previousTimelineContentDurationRef.current = estimatedDuration;
  }, [estimatedDuration, setCurrentTime, setTimelineHorizon, setTimelineZoom, trackScrollRef]);
  const [previewShellNode, setPreviewShellNode] = useState(null);
  const previewFrameSize = usePreviewFrameSize(previewShellRef, ratio, compactRail, previewShellNode);
  const selectedVisualSegment = visualSegments[selectedVisualSegmentIndex] ?? previewVisualSegment ?? null;
  const selectedVisualOverlay = visualOverlaySegments.find((item) => item.id === selectedVisualOverlayId) ?? null;
  const selectedEffectSegment = selectedTrack === "overlay" && selectedVisualOverlay
    ? selectedVisualOverlay
    : selectedVisualSegment;
  const effectVisionKey = getVisionKey(selectedEffectSegment);
  const effectVisionRecord = effectVisionKey ? visionRecords[effectVisionKey] ?? null : null;
  const effectAnalysis = effectVisionRecord?.analysis ?? null;
  const effectRunning = visionJob.running && visionJob.key === effectVisionKey;
  const effectProgress = visionJob.key === effectVisionKey ? visionJob.progress : (effectAnalysis?.complete ? 100 : 0);
  const effectPhase = visionJob.key === effectVisionKey ? visionJob.phase : "";
  const selectedVisualRange = visualTimeline[selectedVisualSegmentIndex] ?? previewVisualRange;
  const [visualAnimationPreview, setVisualAnimationPreview] = useState(null);
  const [visualCanvasEditMode, setVisualCanvasEditMode] = useState("transform");
  useEffect(() => {
    if (!isCompactViewport || mobilePanel !== "inspector" || !mobileInspectorSection) return;
    if (!["visual-clip", "overlay-clip"].includes(mobilePanelOrigin)) return;
    const segment = mobilePanelOrigin === "overlay-clip" ? selectedVisualOverlay : selectedVisualSegment;
    if (!segment) return;
    const isVector = segment.kind === "vector"
      || Boolean(segment.vectorBody)
      || String(segment.assetId || "").startsWith("vector-");
    const supportedSections = getVisualPropertyTabIds({
      isVector,
      isVideo: segment.type === "video",
      isOverlay: mobilePanelOrigin === "overlay-clip",
      hasVectorEditor: isVector,
      isMobile: true,
    });
    if (mobileInspectorSection !== "effects" && !supportedSections.includes(mobileInspectorSection)) setMobileInspectorSection(supportedSections[0] || "transform");
  }, [
    isCompactViewport,
    mobileInspectorSection,
    mobilePanel,
    mobilePanelOrigin,
    selectedVisualOverlay,
    selectedVisualSegment,
  ]);
  useEffect(() => {
    const clearCanvasVisualTarget = (event) => {
      if (editorEventPathContains(event, ".preview-frame")) return;
      setCanvasVisualTarget("");
    };
    document.addEventListener("pointerdown", clearCanvasVisualTarget);
    return () => document.removeEventListener("pointerdown", clearCanvasVisualTarget);
  }, []);
  const visualLocalTime = Math.max(0, Math.min(
    selectedVisualSegment?.duration ?? 0,
    currentTime - (selectedVisualRange?.start ?? 0),
  ));
  const updateSelectedVisualEffects = (change) => {
    if (!selectedVisualSegment?.id || trackLocks.image) return notify("请先选择未锁定的 Visuals 片段");
    setVisualSegments((items) => {
      const nextItems = items.map((item) => {
      if (item.id !== selectedVisualSegment.id) return item;
      if (Number.isFinite(change.playbackRate) && item.type === "video") return updateVisualSegmentPlaybackRate(item, change.playbackRate);
      if (change.speedCurve && item.type === "video") return updateVisualSegmentSpeedCurve(item, change.speedCurve);
      if (change.baseTransform) return {
        ...item,
        baseTransform: normalizeVisualTransform({ ...item.baseTransform, ...change.baseTransform }),
      };
      if (change.keyframe) return { ...item, keyframes: upsertVisualKeyframe(item.keyframes, change.keyframe.time, change.keyframe) };
      if (change.propertyKeyframe) return { ...item, keyframes: upsertVisualPropertyKeyframe(item.keyframes, change.propertyKeyframe.time, change.propertyKeyframe.key, change.propertyKeyframe.value) };
      if (change.removePropertyKeyframe) return { ...item, keyframes: removeVisualPropertyKeyframe(item.keyframes, change.removePropertyKeyframe.time, change.removePropertyKeyframe.key) };
      if (Number.isFinite(change.removeKeyframeAt)) return { ...item, keyframes: (item.keyframes ?? []).filter((frame) => Math.abs(frame.time - change.removeKeyframeAt) > 0.04) };
      if (change.mask) return { ...item, mask: change.mask };
      if (change.animation) return { ...item, animation: change.animation };
      if (typeof change.filterId === "string") return { ...item, filterId: change.filterId };
      if (change.colorGrade) return { ...item, colorGrade: change.colorGrade };
      if (change.subjectEffect) return { ...item, subjectEffect: normalizeSubjectEffect(change.subjectEffect) };
      if (change.cinematicDepth) return { ...item, cinematicDepth: normalizeCinematicDepth(change.cinematicDepth) };
      if (change.photoParallax) return { ...item, photoParallax: normalizePhotoParallax(change.photoParallax) };
      if (change.vectorPatch && (item.kind === "vector" || item.vectorBody)) return { ...item, ...change.vectorPatch };
      if (typeof change.enhancementEnabled === "boolean" && item.enhancement) {
        if (["remaster-drunet-full", "nanovsr-644k"].includes(item.enhancement.mode)) {
          const source = change.enhancementEnabled ? item.enhancement.processed : item.enhancement.original;
          if (!source?.src) return item;
          return {
            ...item,
            src: source.src,
            blob: source.blob,
            width: source.width,
            height: source.height,
            sourceStart: source.sourceStart,
            sourceDuration: source.sourceDuration,
            trackFrames: source.trackFrames ?? [],
            enhancement: { ...item.enhancement, enabled: change.enhancementEnabled },
          };
        }
        if (item.enhancement.previewUrl) return { ...item, enhancement: { ...item.enhancement, enabled: change.enhancementEnabled } };
      }
      if (typeof change.repairEnabled === "boolean" && item.repair) {
        const source = change.repairEnabled ? item.repair.processed : item.repair.original;
        if (!source?.src) return item;
        return {
          ...item,
          src: source.src,
          blob: source.blob,
          width: source.width,
          height: source.height,
          sourceStart: source.sourceStart,
          sourceDuration: source.sourceDuration,
          trackFrames: source.trackFrames ?? [],
          repair: { ...item.repair, enabled: change.repairEnabled },
        };
      }
      return item;
      });
      if (Number.isFinite(change.playbackRate) || change.speedCurve) {
        const nextSegment = nextItems.find((item) => item.id === selectedVisualSegment.id);
        const nextDuration = getVisualSegmentsTotal(nextItems);
        setImageDuration(nextDuration);
        setImageClipCount(getImageThumbnailCount(nextDuration));
        const previousSourceStart = Math.max(0, Number(selectedVisualSegment.sourceStart) || 0);
        const previousSourceDuration = Math.max(0.1, Number(selectedVisualSegment.sourceDuration)
          || (Number(selectedVisualSegment.duration) || 0.1) * (Number(selectedVisualSegment.playbackRate) || 1));
        const sourceProgress = Math.max(0, Math.min(
          1,
          (getVisualSourceTime(selectedVisualSegment, visualLocalTime) - previousSourceStart) / previousSourceDuration,
        ));
        const nextLocalTime = nextSegment?.speedCurve?.enabled
          ? getVisualSpeedCurveTimelineProgress(nextSegment.speedCurve, sourceProgress) * (nextSegment.duration || 0)
          : sourceProgress * (nextSegment?.duration || 0);
        setCurrentTime(() => Math.max(
          selectedVisualRange?.start ?? 0,
          Math.min(
            (selectedVisualRange?.start ?? 0) + (nextSegment?.duration ?? 0),
            (selectedVisualRange?.start ?? 0) + nextLocalTime,
          ),
        ));
      }
      return nextItems;
    });
  };
  const updateSelectedSubjectEffect = (nextEffect) => {
    if (!selectedEffectSegment?.id) return void notify(t("effectSelectClip"));
    const effect = normalizeSubjectEffect(nextEffect);
    if (selectedTrack === "overlay" && selectedVisualOverlay) {
      if (trackLocks.overlay) return void notify(t("effectClipLocked"));
      setVisualOverlaySegments((items) => items.map((item) => item.id === selectedVisualOverlay.id
        ? { ...item, subjectEffect: effect }
        : item));
      return;
    }
    updateSelectedVisualEffects({ subjectEffect: effect });
  };
  const removeSelectedSubjectEffect = () => {
    updateSelectedSubjectEffect(DEFAULT_SUBJECT_EFFECT);
    notify(t("effectRemoved"));
  };
  const miganRepair = useMiganRepair({
    selectedSegment: selectedVisualSegment,
    imageUrlRefs,
    setVisualSegments,
    setUserAssets,
    notify,
    t,
    capabilityRuntime: hostBridge?.capabilityRuntime,
  });
  const hdRestoration = useNanoVsrRestoration({
    selectedSegment: selectedVisualSegment,
    imageUrlRefs,
    setVisualSegments,
    setUserAssets,
    notify,
    t,
    capabilityRuntime: hostBridge?.capabilityRuntime,
  });
  const smartFrame = useSmartFrame({
    selectedSegment: selectedVisualSegment,
    ratioId,
    setRatioId,
    setVisualSegments,
    trackLocked: Boolean(trackLocks.image),
    notify,
  });
  const exportElapsedSeconds = useExportElapsed(exporting, exportStartRef);
  const {
    effectiveCaptionPlacement, previewSmartCropRect, previewVisionAnalysis,
    previewVisionMaskUrl, previewVisionOptions,
    previewSmartBackgroundPosition, previewVisualObjectFit, previewVisualObjectPosition,
    previewVisualRenderSrc,
  } = usePreviewModel({
    captionPlacement, captionSize, captionStyle, currentCaption, fitMode, previewFrameSize,
    previewVideoMediaTime, previewVisionBaseAnalysis, previewVisionRecord,
    previewVisualSourceTime, previewVisualSrc, previewVisualType, ratio,
    previewVisualSegment, previewSmartFrameOverride: smartFrame.previewOverride,
  });

  const { builtInAssets, filteredVoices, libraryType, libraryQuery, setLibraryQuery,
    selectLibraryType, libraryStatus, libraryError, libraryProvider, libraryCategories, assetDownloadStates, prefetchLibraryAsset } = useEditorCatalog(voiceFilter, hostLibraryWorkspace);
  const handleGeneratedVector = (asset) => {
    setUserAssets((current) => [asset, ...current]);
    setSelectedLibraryAssetId(asset.id);
    setMediaTab("mine");
  };
  const handleOpticalFlowAssetReady = async (assetDraft, context = {}) => {
    const operation = context.operation;
    if (!operation) throw new Error("MEDIA_RUNTIME_UNAVAILABLE");
    let saved;
    try { [saved] = await operation.complete([{ blob: assetDraft.blob, title: assetDraft.name, fileName: assetDraft.name }]); }
    catch (error) { await operation.fail(error); throw error; }
    const id = saved.id;
    const src = saved.src;
    imageUrlRefs.current.add(src);
    const asset = { ...assetDraft, ...saved, id, src };
    setUserAssets((current) => [asset, ...current]);
    setSelectedLibraryAssetId(id);
    setActiveTool("media");
    setMediaTab("mine");
    notify(t("effectFlowAddedToAssets"));
    return asset;
  };

  const {
    canDropAssetOnTrack, findAssetById, getActiveDraggedAsset, getDraggedAsset,
    getTimelineDropPercent, handleAssetClick, handleAssetDragEnd, handleAssetDragStart,
    confirmStickerSelection, handleAssetPointerDown, handleStickerClick, handleTrackAssetDragLeave,
    handleTrackAssetDragOver, triggerAssetDropPulse,
  } = createAssetDragControls({
    addStickerAssetToTimeline: (...args) => addStickerAssetToTimeline(...args), applyAssetToTrack: (...args) => applyAssetToTrack(...args), assetDropPulseTimerRef, builtInAssets, currentTime, draggedAssetId,
    draggedAssetIdRef, getStickerDragAsset, notify, pointerAssetDragRef, prefetchAsset: prefetchLibraryAsset,
    setAssetDragPreview, setAssetDropPosition, setAssetDropPulseTrack,
    setAssetDropTargetTrack, setDraggedAssetId, setSelectedLibraryAssetId,
    setSelectedStickerId, setSelectedStickerSegmentId, suppressAssetClickRef,
    t, trackLocks, trackScrollRef, userAssets, editorRootRef: appShellRef,
    isMobileViewport,
  });

  const analyzeCurrentVisual = useVisionAnalysis({
    activeTool,
    notify, previewVideoRef, previewVisionKey, previewVisualSegment, previewVisualSrc,
    previewVisualType, previewVisualRange, setCurrentTime, setPreviewVideoMediaTime,
    setVisionJob, setVisionRecords, visionAbortControllerRef,
    t, visionJob, visionJobGenerationRef, visionObjectUrlsRef,
    capabilityRuntime: hostBridge?.capabilityRuntime,
    onSourcePinned: applyPinnedAssetIdentity,
  });
  const analyzeEffectVisual = useVisionAnalysis({
    activeTool: "effects",
    notify,
    previewVideoRef,
    previewVisionKey: effectVisionKey,
    previewVisualSegment: selectedEffectSegment,
    previewVisualSrc: selectedEffectSegment?.src || "",
    previewVisualType: selectedEffectSegment?.type || "image",
    previewVisualRange: selectedTrack === "overlay" && selectedVisualOverlay
      ? {
          start: selectedVisualOverlay.start || 0,
          end: (selectedVisualOverlay.start || 0) + (selectedVisualOverlay.duration || 0),
        }
      : selectedVisualRange,
    setCurrentTime,
    setPreviewVideoMediaTime,
    setVisionJob,
    setVisionRecords,
    t,
    visionAbortControllerRef,
    visionJob,
    visionJobGenerationRef,
    visionObjectUrlsRef,
    capabilityRuntime: hostBridge?.capabilityRuntime,
    onSourcePinned: applyPinnedAssetIdentity,
  });

  const {
    removeVisionRecordsForAsset, setFitModeFromUser,
  } = createVisionControls({
    imageName, notify, previewVisionAnalysis, previewVisionBaseAnalysis, previewVisionKey,
    previewVisionOptions, previewVisionRecord, previewVisualSegment, previewVisualType,
    setFitMode, setVisionJob, setVisionRecords, visionAbortControllerRef,
    visionJob, visionJobGenerationRef, visionObjectUrlsRef,
  });

  const {
    alignAudioCaptions, alignCaptionToAudio, applyCaptionPositionToAll, commitCaptionSegments, deleteCaptionSegment, handleCaptionPositionChange,
    linkAllCaptionAudio, linkAudioToCaption, linkCaptionAudio,
    startCaptionDrag, toggleCaptionSegmentHidden,
    unlinkAllCaptionAudio, unlinkAudioCaptions, unlinkCaptionAudio, updateCaptionSegmentText, updateScript,
  } = createCaptionEditingActions({
    audioSegments, captionSegments, captionStyle, captionPlacement, captionPosition, selectedCaptionSegment, currentCaptionSegment, focusedSegmentIndex,
    notify, previewCanvasRef, previewVisionKey, previewVisionRecord, script,
    selectedSegmentId, setCaptionPlacement, setCaptionPosition, setCaptionSegments,
    setScript, setSelectedSegmentId, setSelectedTrack,
    setVisionRecords, t, trackLocks,
  });
  const importCaptionSegments = (importedSegments, mode, skipped = 0) => {
    const nextSegments = mode === "append"
      ? appendImportedCaptions(captionSegments, importedSegments)
      : importedSegments;
    const selectedIndex = nextSegments.findIndex((segment) => segment.id === importedSegments[0]?.id);
    commitCaptionSegments(
      nextSegments,
      t("srtImportComplete").replace("{count}", importedSegments.length).replace("{skipped}", skipped),
      Math.max(0, selectedIndex),
    );
    setCaptionsEnabled(true);
    setTrackVisibility((current) => ({ ...current, caption: true }));
  };
  const autoEdit = useAutoEdit({
    language: activeLanguage, visualSegments, captionSegments, commitCaptionSegments, setCaptionsEnabled,
    setTrackVisibility, setSelectedSegmentId, setSelectedTrack, notify, t,
    capabilityRuntime: hostBridge?.capabilityRuntime,
  });
  const {
    clearAudioTrack, clearMusicTrack, clearSourceAudioTrack, commitAudio, commitAudioBatch,
    replaceAudio, replaceMusic, replaceSourceAudio,
  } = createAudioTrackActions({
    audioBlob, audioDuration, audioSegmentRefs, audioSegments, audioSegmentsRef, captionDuration, generatedVoiceEndRef,
    currentTimeRef, imageDuration, imageSrc, musicBlob, musicDuration, musicRef,
    musicUrlRef, notify, script, selectedVoice, selectedVoiceId, setActiveTool,
    setAudioSegments, setCaptionSegments, setCurrentTime, setHistoryItems,
    setIsPlaying, setMusicBlob, setMusicDuration, setMusicName, setMusicPeaks, setMusicSegments,
    setMusicStart, setMusicUrl, setProgress, setSelectedAudioSegmentId, setSelectedMusicSegmentId, setSelectedSegmentId,
    setSelectedTrack, setSourceAudioAssetId, setSourceAudioBlob, setSourceAudioDuration, setSourceAudioLinked, setSourceAudioName,
    setSourceAudioSource, setSourceAudioPeaks, setSourceAudioStart, setSourceAudioUrl, setSourceAudioVolume, setSourceAudioSpatialEffect, setSourceAudioSpatialAmount,
    setStatus, setStatusText, setTimelineHorizon, sourceAudioBlob, sourceAudioDuration,
    sourceAudioAssetId, sourceAudioRef, sourceAudioStart, sourceAudioUrlRef, t,
  });
  const moveSourceAudioToAudioLane = ({ segmentId = "source-audio", start = 0, lane = 0 } = {}) => {
    if (!(sourceAudioBlob instanceof Blob)) return false;
    const linkedPiece = sourceAudioLinked && segmentId !== "source-audio"
      ? linkedSourceAudioSegments.find((segment) => segment.id === segmentId) ?? null
      : null;
    const playbackRate = Math.max(0.25, Math.min(4, Number(linkedPiece?.playbackRate) || 1));
    const duration = Math.max(0, Number(linkedPiece?.duration ?? sourceAudioDuration) || 0);
    if (!(duration > 0)) return false;

    const nextId = crypto.randomUUID();
    const nextUrl = URL.createObjectURL(sourceAudioBlob);
    const sourceStart = Math.max(0, Number(linkedPiece?.sourceStart) || 0);
    const sourceDuration = Math.max(
      0,
      Number(linkedPiece?.sourceDuration) || Math.min(sourceAudioDuration - sourceStart, duration * playbackRate),
    );
    const nextSegment = {
      id: nextId,
      blob: sourceAudioBlob,
      url: nextUrl,
      start: Math.max(0, Number(start) || 0),
      duration,
      sourceStart,
      sourceDuration,
      playbackRate,
      peaks: linkedPiece
        ? sliceSourceAudioPeaks(sourceAudioPeaks, linkedPiece, sourceAudioDuration)
        : sourceAudioPeaks,
      volume: sourceAudioVolume,
      fadeIn: 0,
      fadeOut: 0,
      reversed: false,
      spatialEffect: sourceAudioSpatialEffect,
      spatialAmount: sourceAudioSpatialAmount,
      lane: Math.max(0, Number(lane) || 0),
      name: sourceAudioName || t("sourceTrack"),
      sourceKind: "video-source",
      assetId: linkedPiece?.assetId || sourceAudioAssetId || "",
      ...(sourceAudioSource || {}),
      ...(sourceAudioSource?.original ? { voiceColorOriginal: sourceAudioSource.original } : {}),
      sourceVisualSegmentId: linkedPiece?.id || "",
      sourceAudioWasLinked: Boolean(linkedPiece),
    };

    const hasExplicitSourceMappings = visualSegments.some((segment) => (
      segment.type === "video" && Number.isFinite(segment.sourceAudioOffset)
    ));
    const nextVisualSegments = visualSegments.map((segment) => {
      if (segment.type !== "video") return segment;
      const matchesPiece = linkedPiece
        ? segment.id === linkedPiece.id
        : hasExplicitSourceMappings
          ? Number.isFinite(segment.sourceAudioOffset)
          : Boolean(sourceAudioAssetId && segment.assetId === sourceAudioAssetId);
      return matchesPiece
        ? { ...segment, sourceAudioDisabled: true, sourceAudioRoutedToAudioSegmentId: nextId }
        : segment;
    });
    setVisualSegments(nextVisualSegments);
    setAudioSegments((segments) => [...segments, nextSegment]);

    const remainingLinkedPieces = sourceAudioLinked
      ? getLinkedSourceAudioSegments(nextVisualSegments, sourceAudioAssetId, sourceAudioDuration)
      : [];
    if (!sourceAudioLinked || !remainingLinkedPieces.length) {
      sourceAudioRef.current?.pause?.();
      if (sourceAudioUrlRef.current) URL.revokeObjectURL(sourceAudioUrlRef.current);
      sourceAudioUrlRef.current = "";
      setSourceAudioBlob(null);
      setSourceAudioUrl("");
      setSourceAudioName("");
      setSourceAudioDuration(0);
      setSourceAudioPeaks([]);
      setSourceAudioStart(0);
      setSourceAudioAssetId("");
      // FORK: this clears the lane by hand rather than through
      // `clearSourceAudioTrack`, so it has to drop the host origin too — a lane
      // that is gone must not still name an AssetVersion for the import to
      // restore it from.
      setSourceAudioSource(null);
      setSourceAudioLinked(true);
      setSourceAudioSpatialEffect("original");
      setSourceAudioSpatialAmount(1);
      sourceVoiceColorOriginalRef.current = null;
    }

    setSelectedSourceAudioSegmentId("");
    setSelectedAudioSegmentId(nextId);
    setSelectedTrack("audio");
    setActiveTool("audio");
    setTimelineHorizon((value) => Math.max(value, nextSegment.start + nextSegment.duration));
    notify(t("sourceAudioMovedToAudioTrack"));
    return true;
  };
  const { separateAudioClipVocals, separateSourceVocals, vocalSeparationJob } = useVocalSeparation({
    sourceAudioBlob, sourceAudioName, sourceAudioDuration, sourceAudioStart, sourceAudioSource, notify, t,
    authorizedAssetsRef: hostAuthorizedAssetsRef,
    capabilityRuntime: hostBridge?.capabilityRuntime,
  });
  const selectedSourceAudioPiece = linkedSourceAudioSegments.find((segment) => segment.id === selectedSourceAudioSegmentId) ?? null;
  const selectedMusicSegment = musicSegments.find((segment) => segment.id === selectedMusicSegmentId) ?? null;
  useEffect(() => {
    if (selectedMusicSegmentId && !selectedMusicSegment) setSelectedMusicSegmentId("");
  }, [selectedMusicSegment, selectedMusicSegmentId]);
  const selectedAudioToolTarget = selectedTrack === "audio" && selectedAudioSegmentId && selectedAudioSegment
    ? { ...selectedAudioSegment, segmentId: selectedAudioSegment.id, track: "audio", canChangeSpeed: true }
    : selectedTrack === "music" && musicBlob
      ? { ...(selectedMusicSegment ?? musicSegments[0] ?? { id: "music-audio", start: musicStart, duration: musicDuration, sourceStart: 0, sourceDuration: musicDuration, playbackRate: 1 }), blob: musicBlob, name: musicName || t("musicTrack"), segmentId: selectedMusicSegment?.id || musicSegments[0]?.id || "music-audio", track: "music", volume: selectedMusicSegment?.volume ?? musicSegments[0]?.volume ?? musicVolume, canChangeSpeed: true }
      : selectedTrack === "source" && (sourceAudioBlob || sourceAudioSource)
        ? { ...(selectedSourceAudioPiece ?? {}), blob: sourceAudioBlob, name: sourceAudioName, start: selectedSourceAudioPiece?.start ?? sourceAudioStart, sourceStart: selectedSourceAudioPiece?.sourceStart ?? 0, duration: selectedSourceAudioPiece?.duration ?? sourceAudioDuration, sourceDuration: selectedSourceAudioPiece?.sourceDuration ?? sourceAudioDuration, playbackRate: selectedSourceAudioPiece?.playbackRate ?? 1, segmentId: selectedSourceAudioSegmentId || "source-audio", track: "source", volume: sourceAudioVolume, spatialEffect: sourceAudioSpatialEffect, spatialAmount: sourceAudioSpatialAmount, canChangeStart: !sourceAudioLinked, canChangeSpeed: Boolean(sourceAudioLinked && selectedSourceAudioPiece), voiceColorOriginal: sourceAudioSource?.original || null, ...sourceAudioSource }
        : null;
  const separateSelectedAudioVocals = () => selectedAudioToolTarget?.track === "source" && selectedAudioToolTarget.segmentId === "source-audio"
    ? separateSourceVocals()
    : selectedAudioToolTarget && separateAudioClipVocals(selectedAudioToolTarget);

  const {
    chooseInterfaceLanguage, clearAllVisionState, selectTool, toggleTrackLock,
    toggleTrackVisibility, useHistoryItem,
  } = createEditorCommandActions({
    notify, replaceAudio, script, selectedTrack, setActiveTool, setAvatarPanelOpen, setCaptionSegments,
    setIntroClosing, setScript, setSelectedSegmentId, setSelectedTrack,
    setSelectedVoiceId, setTrackLocks, setTrackVisibility, setUiLanguage,
    setVisionJob, setVisionRecords, setVoiceTab, visionAbortControllerRef,
    visionJobGenerationRef, visionObjectUrlsRef,
  });

  const {
    appendVisualAssetToTimeline, clearImageTrack, commitVisualSegments,
    getCurrentVisualAssetSnapshot, getVisualDurationForAsset, replaceVisualTimeline,
    setCurrentVisualAsset, updateVisualAssetInTimeline,
  } = createVisualTimelineActions({
    audioBlob, audioDuration, captionDuration,
    extractVideoSourceAudio: (...args) => extractVideoSourceAudio(...args),
    imageDuration, imageMeta, imageName, imageSrc, musicBlob, musicDuration, notify,
    previewVisualSegment, script, seekTo: (...args) => seekTo(...args), setCurrentTime,
    setFitMode, setImageClipCount, setImageDuration, setImageMeta, setImageName,
    setImageSrc, setSelectedTrack, setSelectedVisualSegmentId, setVisualSegments,
    setTimelineZoom, setVisualType, sourceAudioBlob, sourceAudioDuration, sourceAudioStart, trackLocks,
    visualSegments, visualSegmentsRef, visualType,
  });

  const {
    addStickerAssetToTimeline, commitStickerSegments, getTimelineTimeFromDropPercent,
  } = createStickerTimelineActions({
    estimatedDuration, notify, seekTo: (...args) => seekTo(...args), setActiveTool,
    setSelectedStickerId, setSelectedStickerSegmentId, setSelectedTrack,
    setStickerSegments, stickerSegments, t, timelineDurationRef, trackLocks,
  });
  const selectedStickerSegment = stickerSegments.find((segment) => segment.id === selectedStickerSegmentId) ?? currentStickerSegment;
  useEffect(() => {
    const normalized = normalizeTimedSegmentIds(stickerSegments, "sticker");
    if (normalized !== stickerSegments) setStickerSegments(normalized);
  }, [setStickerSegments, stickerSegments]);
  const updateSelectedStickerSegment = (change) => {
    if (!selectedStickerSegment?.id) return;
    setStickerSegments((segments) => segments.map((segment) => segment.id === selectedStickerSegment.id ? { ...segment, ...change } : segment));
  };
  const updateCanvasStickerSegment = (segmentId, change) => {
    if (!segmentId) return;
    setStickerSegments((segments) => segments.map((segment) => segment.id === segmentId ? { ...segment, ...change } : segment));
  };
  const selectCanvasStickerSegment = (segmentId) => {
    if (!segmentId) return;
    setSelectedStickerSegmentId(segmentId);
    setSelectedTrack("sticker");
  };
  const deleteSelectedStickerSegment = () => {
    if (!selectedStickerSegment?.id) return;
    commitStickerSegments(stickerSegments.filter((segment) => segment.id !== selectedStickerSegment.id), "已删除贴纸片段");
  };

  const { generateAvatarAcceptanceFrame, openAvatarPanel } = useAvatarGeneration({
    audioBlob, audioDuration, avatarJob, avatarMotionCacheRef, avatarMotionWorkerRef,
    avatarRenderWorkerRef, imageDuration, imageUrlRefs, notify, previewVisualSegment,
    previewVisualSrc, previewVisualType, replaceVisualTimeline, setAvatarJob,
    setAvatarPanelOpen, setCurrentTime, setUserAssets, t,
    capabilityRuntime: hostBridge?.capabilityRuntime,
  });
  const faceSwap = useFaceSwapGeneration({
    downloadBlob, imageDuration, imageUrlRefs, notify, previewVisualSegment, previewVisualSrc,
    previewVisualType, setActiveTool, setMediaTab, setSelectedLibraryAssetId,
    setUserAssets, t, capabilityRuntime: hostBridge?.capabilityRuntime,
  });

  const { startVoiceRecording, stopVoiceRecording } = useVoiceRecorder({
    notify, recordingState, setActiveTool, setProgress,
    setRecordedVoices, setRecordingElapsed, setRecordingState,
    setStatus, setStatusText, setVoiceTab, t, voiceRecorderChunksRef,
    voiceRecorderRef, voiceRecorderStartedAtRef, voiceRecorderStreamRef,
    voiceRecorderTimerRef,
  });

  const generateVoiceover = useVoiceGeneration({
    addVoiceProfile, commitAudio, commitAudioBatch, notify, script, selectedVoice, setProgress, setStatus,
    setStatusText, setVoiceTab, speed, status, t, selectedVoiceProfile, volume,
    // Placement reads these; without them generated voice lands at 0 instead of
    // after the playhead / the last generated clip (and currentTimeRef, read
    // without `?.` before, threw outright).
    audioSegments, audioSegmentsRef, currentTimeRef, generatedVoiceEndRef,
    capabilityRuntime: hostBridge?.capabilityRuntime,
  });

  // FORK: the host speaks a caption with the editor's own voice — the file
  // menu's "剧本进时间线 · 配音" places one caption per shot through the daemon,
  // then asks for each caption here. The latest callback and state sit in a
  // ref because the host connection below is made once.
  const hostVoiceRef = useRef({ generateVoiceover, captionSegments, status, statusText, setCaptionSegments });
  hostVoiceRef.current = { generateVoiceover, captionSegments, status, statusText, setCaptionSegments };
  // FORK: what is selected, for the host's own clip-level actions. Read
  // through a ref because the bridge connects once and would otherwise hold
  // the selection this render happened to have.
  const hostSelectionRef = useRef(null);
  hostSelectionRef.current = { selectedTrack, selectedVisualSegmentId, selectedAudioSegmentId, musicSegments };

  const { deleteAudioSegment, toggleAudioSegmentReverse, updateAudioSegment } = createAudioClipActions({
    audioSegmentRefs, audioSegments, notify, setAudioSegments, setCaptionSegments,
    setSelectedAudioSegmentId, setTimelineHorizon, t,
  });
  const audioSendingRef = useRef(false);
  const [audioSending, setAudioSending] = useState(false);
  const sendAudioToCanvas = hostBridge?.hostActions?.keepExport ? async (track, segmentId) => {
    if (audioSendingRef.current) return;
    const sourcePiece = sourceAudioLinked && segmentId !== "source-audio"
      ? linkedSourceAudioSegments.find(item => item.id === segmentId) : null;
    const segment = track === "source" ? (sourceAudioLinked ? sourcePiece : { duration: sourceAudioDuration, sourceStart: 0 })
      : track === "audio" ? audioSegments.find(item => item.id === segmentId)
      : track === "music" ? musicSegments.find(item => item.id === segmentId) || (segmentId === "music-audio" ? { duration: musicDuration } : null) : null;
    if (!segment) return notify("请先选择要发送的音频片段");
    const blob = track === "source" ? sourceAudioBlob : track === "music" ? musicBlob : segment.blob;
    audioSendingRef.current = true; setAudioSending(true);
    try {
      const { renderAudioClipFile } = await import("./lib/audioClipExport.js");
      const file = await renderAudioClipFile({ ...segment, blob,
        name: track === "source" ? sourceAudioName : track === "music" ? musicName : segment.name,
        ...(track === "source" ? { volume: sourceAudioVolume, spatialEffect: sourceAudioSpatialEffect, spatialAmount: sourceAudioSpatialAmount }
          : track === "music" ? { volume: segment.volume ?? musicVolume } : {}),
      }, hostAuthorizedAssetsRef.current);
      const kept = await hostBridge.hostActions.keepExport.keep([file]);
      if (!kept) notify("音频未能发送到画布，原片段已保留，请重试");
    } catch (error) { notify(`音频发送失败：${error?.message || error}`); }
    finally { audioSendingRef.current = false; setAudioSending(false); }
  } : undefined;

  const handleVoiceColorAssetReady = async ({ blob, decoded, profileName, sourceName, operation }) => {
    const name = `${sourceName || t("audioClip")} · ${profileName}`;
    const [saved] = await operation.complete([{ blob, title: name, fileName: `${name}.wav` }]);
    const asset = { ...saved, type: "audio", kind: "voiceover", name, duration: decoded.duration, peaks: decoded.peaks, generated: true, provider: "OpenVoice V2 · ONNX" };
    setUserAssets(items => [asset, ...items.filter(item => item.assetVersionId !== asset.assetVersionId)]);
    setSelectedLibraryAssetId(asset.id);
    return asset;
  };
  const applyVoiceColorToSelectedAudio = async ({ asset, segment }) => {
    if (!asset?.assetVersionId) throw new Error("声音结果尚未保存");
    const sourceClip = segment.track === "source" && segment.id !== "source-audio";
    const clipId = sourceClip ? `voice-source:${asset.taskId}` : segment.id;
    await hostBridge.capabilityRuntime.commitTimeline({
      operationId: `voice-color:${asset.taskId}`, baseRevision: asset.timelineRevision,
      operations: [{ id: `voice-color:${asset.taskId}`, type: "asset.place_version", assetId: asset.assetId, versionId: asset.assetVersionId,
        clipId,
        track: segment.track === "source" && !sourceClip ? "source" : "audio", duration: asset.duration,
        ...(sourceClip ? { disableSourceClipId: segment.id } : segment.track === "source" ? { replace: true } : { replaceClipId: segment.id }), preserveOriginal: true }],
    });
    if (sourceClip) { setSelectedTrack("audio"); setSelectedAudioSegmentId(clipId); }
    notify(t("voiceColorClipReplaced", "已替换当前片段，可随时恢复原始声音"));
    return true;
  };
  const restoreSelectedAudioVoiceColor = async (segment) => {
    const original = segment.track === "source" ? sourceAudioSource?.original : segment.voiceColorOriginal;
    if (!original?.assetVersionId) throw new Error("未找到持久化原声版本");
    const revision = await hostBridge.capabilityRuntime.captureTimeline();
    const operationId = `restore-voice:${crypto.randomUUID()}`;
    await hostBridge.capabilityRuntime.commitTimeline({ operationId, baseRevision: revision,
      operations: [{ id: operationId, type: "asset.place_version", assetId: original.assetId, versionId: original.assetVersionId,
        name: original.name || segment.name, clipId: segment.track === "source" ? operationId : segment.id,
        track: segment.track === "source" ? "source" : "audio", duration: segment.duration,
        ...(segment.track === "source" ? { replace: true } : { replaceClipId: segment.id }), restoreOriginal: true }],
    });
    notify(t("voiceColorOriginalRestored", "已恢复原始声音")); return true;
  };
  const updateSelectedTrackAudioSegment = (id, patch) => {
    if (selectedTrack === "audio") return updateAudioSegment(id, patch);
    if (selectedTrack === "music") {
      setMusicSegments((segments) => {
        const source = segments.length ? segments : [{ id: "music-audio", start: musicStart, duration: musicDuration, sourceStart: 0, sourceDuration: musicDuration, playbackRate: 1, peaks: musicPeaks }];
        const next = source.map((segment) => {
          if (segment.id !== id) return segment;
          const normalizedPatch = Number.isFinite(patch.volume)
            ? { ...patch, volume: Math.max(0, Math.min(4, patch.volume)) }
            : patch;
          return Number.isFinite(normalizedPatch.playbackRate)
            ? { ...updateAudioSegmentPlaybackRate(segment, normalizedPatch.playbackRate), ...normalizedPatch }
            : { ...segment, ...normalizedPatch };
        });
        const nextStart = Math.min(...next.map((segment) => segment.start));
        setMusicStart(nextStart);
        return next;
      });
      return;
    }
    if (selectedTrack === "source") {
      if (Number.isFinite(patch.volume)) setSourceAudioVolume(Math.max(0, Math.min(4, patch.volume)));
      if (typeof patch.spatialEffect === "string") setSourceAudioSpatialEffect(patch.spatialEffect);
      if (Number.isFinite(patch.spatialAmount)) setSourceAudioSpatialAmount(Math.max(0, Math.min(1, patch.spatialAmount)));
      if (!sourceAudioLinked && Number.isFinite(patch.start)) setSourceAudioStart(Math.max(0, patch.start));
      if (sourceAudioLinked && id !== "source-audio" && Number.isFinite(patch.playbackRate)) {
        setVisualSegments((segments) => {
          const next = segments.map((segment) => segment.id === id ? updateVisualSegmentPlaybackRate(segment, patch.playbackRate) : segment);
          const nextDuration = getVisualSegmentsTotal(next);
          setImageDuration(nextDuration);
          setImageClipCount(getImageThumbnailCount(nextDuration));
          return next;
        });
      }
    }
  };

  const { handleAddCaptionSegment, handleAddSegment, handleRemoveSegment } = createTimelineSegmentCountActions({
    captionSegments, clearImageTrack, commitCaptionSegments, commitStickerSegments,
    commitVisualSegments, currentStickerSegmentIndex, currentTime, captionStyle,
    currentVisualSegmentIndex, deleteCaptionSegment, focusedSegmentIndex,
    getCurrentVisualAssetSnapshot, getStickerDragAsset, imageClipCount,
    imageDuration, imageSrc, notify, selectedSegmentId, selectedSegmentIndex,
    selectedSticker, selectedStickerSegmentId, selectedTrack,
    selectedVisualSegmentId, selectedVisualSegmentIndex, stickerSegments,
    t, trackLocks, visualSegments,
  });

  const adjustSelectedSegmentWeight = createTimelineDurationActions({
    captionSegments, commitCaptionSegments, commitStickerSegments,
    commitVisualSegments, currentStickerSegmentIndex, currentVisualSegmentIndex,
    focusedSegmentIndex, getCurrentVisualAssetSnapshot, imageDuration, imageSrc,
    notify, selectedSegmentId, selectedSegmentIndex, selectedStickerSegmentId,
    selectedTrack, selectedVisualSegmentId, selectedVisualSegmentIndex,
    stickerSegments, trackLocks, visualSegments,
  });

  const { handleDeleteTrack, handleDuplicateTrack } = createTimelineClipboardActions({
    audioBlob, audioSegments, captionSegments, clearImageTrack, clearMusicTrack, clearSourceAudioTrack,
    commitCaptionSegments, commitStickerSegments, commitVisualSegments,
    currentStickerSegmentIndex, currentVisualSegmentIndex, deleteAudioSegment,
    focusedSegmentIndex, getCurrentVisualAssetSnapshot, handleRemoveSegment,
    imageClipCount, imageDuration, imageMeta, imageName, imageSrc, musicBlob, musicDuration, musicName, musicPeaks, musicSegments, musicStart,
    notify, selectedAudioSegment, selectedAudioSegmentId, selectedMusicSegmentId, selectedSegmentId,
    selectedSegmentIndex, selectedStickerSegmentId, selectedTrack,
    selectedVisualSegmentId, selectedVisualSegmentIndex, setAudioSegments,
    setCaptionSegments, setMusicSegments, setMusicStart, setSelectedAudioSegmentId, setSelectedMusicSegmentId, sourceAudioBlob,
    sourceAudioLinked, sourceAudioName, selectedSourceAudioSegmentId, linkedSourceAudioSegments,
    setSelectedSourceAudioSegmentId, stickerSegments, t, trackLocks, visualSegments, visualType,
    visualOverlaySegments, selectedVisualOverlayId, setVisualOverlaySegments, setSelectedVisualOverlayId,
  });

  useEditorLifecycle({
    activeLanguage, audioSegments, audioUrlRef, autoRatioSourceKeyRef,
    avatarMotionWorkerRef, avatarRenderWorkerRef, captionSegments, currentVisualSegment, handleDeleteTrack,
    imageUrlRefs, musicBlob, musicUrlRef, notify, ratioId, replaceAudio,
    replaceVisualTimeline, selectedAudioSegmentId, selectedSegmentId,
    selectedStickerSegmentId, selectedTrack, selectedVisualSegmentId, setCurrentVisualAsset,
    selectedVisualOverlayId, visualOverlaySegments,
    setFitMode, setRatioId, setSelectedSegmentId, setSelectedVisualSegmentId,
    setUserAssets, setVisualSegments, sourceAudioBlob, sourceAudioUrlRef, stickerSegments,
    setSelectedVisualOverlayId,
    visionAbortControllerRef, visionObjectUrlsRef, visualSegments,
    voiceRecorderStreamRef, voiceRecorderTimerRef,
  });

  const { handleCutTrack } = createTimelineCutActions({
    audioSegments, captionSegments, captionTargetDuration, commitCaptionSegments, commitStickerSegments, commitVisualSegments,
    currentStickerSegmentIndex, currentTime, focusedSegmentIndex,
    getCurrentVisualAssetSnapshot, imageDuration, imageSrc, notify,
    musicBlob, musicDuration, musicPeaks, musicSegments, musicStart,
    selectedAudioSegmentId, selectedMusicSegmentId, selectedSegmentId, selectedSegmentIndex, selectedStickerSegmentId,
    setAudioSegments, setCaptionSegments, setMusicSegments, setSelectedAudioSegmentId, setSelectedMusicSegmentId,
    selectedTrack, stickerSegments, t, trackLocks, visualSegments,
    visualOverlaySegments, selectedVisualOverlayId, setVisualOverlaySegments, setSelectedVisualOverlayId,
  });

  const seekGestureRef = useRef(null);
  useEffect(() => () => seekGestureRef.current?.(), []);
  const { getTimelineTimeFromClientX, handlePlayToggle, pauseTimelineMedia, seekTo, startTimelineSeek } = createPlaybackControls({
    seekGestureRef,
    audioSegmentRefs, audioSegments, canPreview, currentTimeRef, currentVisualRange,
    estimatedDuration, isPlaying, musicDuration, musicSegments, musicRef, musicStart, musicUrl, notify,
    linkedSourceAudioSegments, previewVideoRef, previewVisualType, setCurrentTime, setIsPlaying, setPreviewVideoMediaTime, sourceAudioDuration,
    sourceAudioLinked,
    sourceAudioRef, sourceAudioStart, sourceAudioUrl, sourceAudioVolume, sourceAudioSpatialEffect, sourceAudioSpatialAmount, timelineDuration,
    timelineDurationRef, trackScrollRef, trackVisibility, visualSegments, visualTimeline, previewVisualSegment,
    visualPlaybackLastUpdateRef, visualPlaybackStartedAtRef, visualPlaybackStartTimeRef,
  });
  const pauseForTimelineEdit = () => {
    if (!isPlaying) return;
    pauseTimelineMedia();
    setIsPlaying(false);
  };

  const attachPreviewVideo = useMediaSync({
    audioRef, audioSegmentRefs, audioSegments, currentTime, currentTimeRef, estimatedDuration,
    isPlaying, musicDuration, musicSegments, musicRef, musicStart, musicUrl, musicVolume, pauseTimelineMedia, previewVideoRef,
    previewVisualSegment, previewVisualSourceTime, previewVisualSrc, previewVisualType,
    previewVisualRange,
    linkedSourceAudioSegments, setCurrentTime, setIsPlaying, setPreviewVideoMediaTime, sourceAudioDuration,
    sourceAudioLinked,
    sourceAudioRef, sourceAudioStart, sourceAudioUrl, sourceAudioVolume, sourceAudioSpatialEffect, sourceAudioSpatialAmount, timelineDuration,
    trackVisibility, visualPlaybackFrameRef, visualPlaybackLastUpdateRef,
    visualPlaybackStartedAtRef, visualPlaybackStartTimeRef,
  });

  const { startAudioSegmentMove, startMusicMove, startSourceAudioMove, startStickerSegmentMove, startStickerSegmentResize } = createTimelineMoveControls({
    audioSegments, captionSegments, captionTargetDuration, estimatedDuration, notify, seekTo, setActiveTool,
    setAudioSegments, setCaptionSegments, setSelectedAudioSegmentId, setSelectedStickerId,
    setSelectedStickerSegmentId, setSelectedTrack, setStickerSegments, setTimelineHorizon,
    setMusicStart, setSelectedMusicSegmentId, setSelectedSourceAudioSegmentId, setSourceAudioLinked, setSourceAudioStart, musicDuration, musicSegments, musicStart, setMusicSegments,
    linkedSourceAudioSegments, sourceAudioDuration, sourceAudioLinked, sourceAudioStart, stickerSegments, suppressTimelineClipClickRef, t, timelineDurationRef,
    trackLocks, trackVisibility, trackScrollRef, pauseForTimelineEdit, visualSegments, setVisualSegments, visualOverlaySegments, currentTime, setSnapGuide, commitStickerSegments,
    setStickerTimelineDrag, moveSourceAudioToAudioLane, setSourceAudioDragTargetLane,
    isMobileViewport,
  });

  const [hostDocumentBusy, setHostDocumentBusy] = useState(false);
  useEffect(() => { if (hostDocumentBusy) seekGestureRef.current?.(); }, [hostDocumentBusy]);
  const trimGestureRef = useRef(null);
  const currentTrimContext = useRef(null);
  currentTrimContext.current = { visualSegments, locked: trackLocks.image || hostDocumentBusy };
  useEffect(() => () => trimGestureRef.current?.(), []);
  const startImageResize = createImageResizeControl({
    trimGestureRef, currentTrimContext, setTimelineClipDrag, commitVisualSegments,
    audioBlob, audioDuration, captionDuration, getCurrentVisualAssetSnapshot,
    imageDuration, imageSrc, musicBlob, musicDuration, musicStart, notify, script,
    setCurrentTime, setImageClipCount, setImageDuration, setSelectedTrack,
    setSelectedVisualSegmentId, setSnapGuide, setVisualSegments, sourceAudioBlob,
    sourceAudioDuration, sourceAudioStart, timelineDuration, timelineDurationRef,
    setTimelineHorizon, trackLocks, trackScrollRef, visualSegments, pauseForTimelineEdit,
  });

  const extractVideoSourceAudio = useSourceAudioExtraction({
    clearSourceAudioTrack, notify, replaceSourceAudio, setProgress, setStatus, setStatusText,
    replaceAudio, setVisualOverlaySegments, setVisualSegments, sourceAudioBlob, sourceAudioDuration, sourceAudioSource, sourceAudioStart, visualSegmentsRef, t, userAssets,
    capabilityRuntime: hostBridge?.capabilityRuntime, authorizedAssetsRef: hostAuthorizedAssetsRef,
  });

  const generateCaptionsFromSourceAudio = useAutoCaptions({
    notify, script, seekTo, setActiveTool, setCaptionSegments, captionStyle,
    setCaptionsEnabled, setProgress, setScript, setSelectedSegmentId,
    setSelectedTrack, setStatus, setStatusText, setTrackVisibility, sourceAudioBlob,
    sourceAudioStart, status, t, trackLocks, uiLanguage,
    capabilityRuntime: hostBridge?.capabilityRuntime,
  });

  const handleFiles = useFileUpload({
    appendVisualAssetToTimeline, imageUrlRefs, notify, setSelectedLibraryAssetId, setSelectedTrack, setUserAssets,
    updateVisualAssetInTimeline, visualSegments, t,
    onFirstVisualAutoAdded: requestFirstVisualGuide,
    capabilityRuntime: hostBridge?.capabilityRuntime,
    onAssetPinned: applyPinnedAssetIdentity,
    claimFirstVisualAutoAdd,
  });

  const { deleteUserAsset, selectAsset } = createAssetLibraryActions({
    clearImageTrack, clearMusicTrack, clearSourceAudioTrack, commitVisualSegments,
    extractVideoSourceAudio, getVisualDurationForAsset, imageSrc, imageUrlRefs,
    musicBlob, notify, removeVisionRecordsForAsset, replaceMusic, replaceVisualTimeline,
    selectedLibraryAssetId, setSelectedLibraryAssetId, setUserAssets, sourceAudioBlob,
    userAssets, visualSegments,
  });

  const { applyAssetToTrack, handleTrackAssetDrop, handleVisualStyleDrop } = createAssetDropActions({
    addStickerAssetToTimeline, addVisualOverlay: (...args) => addVisualOverlay(...args), appendVisualAssetToTimeline, canDropAssetOnTrack, clearImageTrack,
    draggedAssetIdRef, extractVideoSourceAudio, getDraggedAsset, getTimelineDropPercent, imageUrlRefs,
    notify, onFirstVisualDropped: requestFirstVisualGuide, replaceAudio, selectAsset, setActiveTool, setAssetDropPosition,
    capabilityRuntime: hostBridge?.capabilityRuntime,
    onProjectFilePinned: applyPinnedAssetIdentity,
    setAssetDropTargetTrack, setDraggedAssetId, setSelectedFilterId,
    setSelectedLibraryAssetId, setUserAssets, setSelectedTrack, setSelectedTransitionId,
    setSelectedVisualSegmentId, setVisualSegments, trackScrollRef, resolveVisualDropIntent, updateVisualAssetInTimeline,
    t, timelineDuration, triggerAssetDropPulse, visualSegments, visualSegmentsRef,
  });
  const addVisualOverlay = (asset, options = {}) => {
    if (!asset?.src || (asset.type !== "image" && asset.type !== "video")) return;
    const startTime = Number.isFinite(options.startTime)
      ? options.startTime
      : Number.isFinite(options.percent)
        ? options.percent / 100 * timelineDuration
        : currentTime;
    const targetLayer = Number.isFinite(Number(options.layer))
      ? Math.max(1, Number(options.layer))
      : visualOverlaySegments.length + 1;
    const overlay = createVisualOverlaySegment(asset, startTime, {
      layer: targetLayer,
      ...(Number.isFinite(Number(options.layer)) ? { lane: targetLayer - 1 } : {}),
    });
    setVisualOverlaySegments((items) => [...items, overlay]);
    setSelectedVisualOverlayId(overlay.id);
    setSelectedVisualSegmentId("");
    setSelectedTrack("overlay");
    notify("已添加为画中画，可在预览中拖动、缩放和旋转");
  };
  const updateVisualOverlayById = (overlayId, transform) => {
    if (!overlayId || trackLocks.overlay) return;
    setVisualOverlaySegments((items) => items.map((item) => {
      if (item.id !== overlayId) return item;
      const localTime = Math.max(0, currentTime - item.start);
      return item.keyframes?.length
        ? updateVisualOverlayTransform(item, localTime, transform)
        : { ...item, baseTransform: normalizeVisualTransform({ ...item.baseTransform, ...transform }) };
    }));
  };
  const updateSelectedVisualOverlay = (transform) => updateVisualOverlayById(selectedVisualOverlayId, transform);
  const updateSelectedVisualOverlayEffects = (change) => {
    const overlay = visualOverlaySegments.find((item) => item.id === selectedVisualOverlayId);
    if (!overlay || trackLocks.overlay) return;
    setVisualOverlaySegments((items) => items.map((item) => {
      if (item.id !== overlay.id) return item;
      if (Number.isFinite(change.playbackRate) && item.type === "video") return updateVisualSegmentPlaybackRate(item, change.playbackRate);
      if (change.baseTransform) return { ...item, baseTransform: normalizeVisualTransform({ ...item.baseTransform, ...change.baseTransform }) };
      if (change.keyframe) return { ...item, keyframes: upsertVisualKeyframe(item.keyframes, change.keyframe.time, change.keyframe) };
      if (change.propertyKeyframe) return { ...item, keyframes: upsertVisualPropertyKeyframe(item.keyframes, change.propertyKeyframe.time, change.propertyKeyframe.key, change.propertyKeyframe.value) };
      if (change.removePropertyKeyframe) return { ...item, keyframes: removeVisualPropertyKeyframe(item.keyframes, change.removePropertyKeyframe.time, change.removePropertyKeyframe.key) };
      if (Number.isFinite(change.removeKeyframeAt)) return { ...item, keyframes: (item.keyframes ?? []).filter((frame) => Math.abs(frame.time - change.removeKeyframeAt) > 0.04) };
      if (change.mask) return { ...item, mask: change.mask };
      if (change.animation) return { ...item, animation: change.animation };
      if (change.subjectEffect) return { ...item, subjectEffect: normalizeSubjectEffect(change.subjectEffect) };
      if (change.cinematicDepth) return { ...item, cinematicDepth: normalizeCinematicDepth(change.cinematicDepth) };
      if (change.photoParallax) return { ...item, photoParallax: normalizePhotoParallax(change.photoParallax) };
      if (change.timing) return { ...item, ...change.timing };
      if (typeof change.filterId === "string") return { ...item, filterId: change.filterId };
      return item;
    }));
  };

  const updateSelectedCinematicDepth = (nextEffect) => {
    const cinematicDepth = normalizeCinematicDepth(nextEffect);
    if (selectedTrack === "overlay" && selectedVisualOverlay) {
      updateSelectedVisualOverlayEffects({ cinematicDepth });
      return;
    }
    updateSelectedVisualEffects({ cinematicDepth });
  };
  const updateSelectedPhotoParallax = (nextEffect) => {
    const photoParallax = normalizePhotoParallax(nextEffect);
    if (selectedTrack === "overlay" && selectedVisualOverlay) {
      updateSelectedVisualOverlayEffects({ photoParallax });
      return;
    }
    updateSelectedVisualEffects({ photoParallax });
  };
  const depthTimelineStart = selectedTrack === "overlay" && selectedVisualOverlay
    ? selectedVisualOverlay.start || 0
    : selectedVisualRange?.start || 0;
  const cinematicDepth = useDepthOfFieldAnalysis({
    segment: selectedEffectSegment,
    depthRecords,
    setDepthRecords,
    updateEffect: updateSelectedCinematicDepth,
    notify,
    setCurrentTime,
    timelineStart: depthTimelineStart,
    t,
    capabilityRuntime: hostBridge?.capabilityRuntime,
    onSourcePinned: applyPinnedAssetIdentity,
  });
  const photoParallaxDepth = useDepthOfFieldAnalysis({
    segment: selectedEffectSegment,
    depthRecords,
    setDepthRecords,
    updateEffect: updateSelectedPhotoParallax,
    effectField: "photoParallax",
    readyToastKey: "parallaxReadyToast",
    notify,
    setCurrentTime,
    timelineStart: depthTimelineStart,
    t,
    capabilityRuntime: hostBridge?.capabilityRuntime,
    onSourcePinned: applyPinnedAssetIdentity,
  });
  const previewDepthRecord = previewVisionKey ? depthRecords[previewVisionKey] || null : null;
  const previewDepthAnalysis = resolveDepthAnalysisAtTime(previewDepthRecord, previewVisualSourceTime);
  const previewVisualOverlaysWithDepth = useMemo(() => previewVisualOverlays.map((overlay) => {
    const depthRecord = depthRecords[getVisionKey(overlay)];
    if (!depthRecord) return overlay;
    const localTime = Math.max(0, currentTime - (overlay.start || 0));
    const sourceTime = overlay.type === "video" ? getVisualSourceTime(overlay, localTime) : localTime;
    return { ...overlay, depthAnalysis: resolveDepthAnalysisAtTime(depthRecord, sourceTime) };
  }), [currentTime, depthRecords, previewVisualOverlays]);

  const { getProjectSnapshot, handleExportProject, handleImportProject, handleNewProject, acceptProjectBaseline } = useProjectFiles({
    setMusicName, setMusicDuration,
    audioBlob, audioDuration, audioSegments, autoRatioSourceKeyRef, captionPlacement, captionPosition, captionSegments, captionSize,
    captionStyle, captionsEnabled, captionStyleFallback: captionStyle, clearAllVisionState,
    clearAudioTrack, clearImageTrack, clearMusicTrack, clearSourceAudioTrack, fitMode,
    imageUrlRefs, musicBlob, musicDuration, musicName, musicStart, musicVolume, notify, projectFileInputRef,
    ratioId, replaceAudio, replaceMusic, replaceSourceAudio, script, selectedFilterId,
    selectedStickerId, selectedTransitionId, selectedVoiceId, setCaptionPlacement,
    setCaptionPosition, setCaptionSegments, setCaptionSize, setCaptionStyle, setCaptionsEnabled,
    // FORK: the import hook reads and writes the music track's segments
    // (deps.musicSegments / deps.setMusicSegments) but App never handed them
    // over: importing a document that carried a music clip threw
    // "deps.setMusicSegments is not a function" halfway, and the next autosave
    // wrote the half-imported state back — the daemon's music bed gone.
    musicSegments, setMusicSegments,
    setAudioSegments, setCurrentTime, setFitMode, setImageClipCount, setImageDuration, setMusicStart, setMusicVolume, setSelectedAudioSegmentId,
    setRatioId, setScript, setSelectedFilterId, setSelectedSegmentId, setSelectedStickerId,
    setSelectedStickerSegmentId, setSelectedTransitionId, setSelectedVoiceId, setShowFileMenu,
    setSourceAudioAssetId, setSourceAudioLinked, setSourceAudioVolume, setSourceAudioSpatialEffect, setSourceAudioSpatialAmount, setSpeed, setStickerSegments, setTimelineZoom, setTrackLocks, setTrackVisibility,
    // FORK: the import restores the source-audio lane from the AssetVersion it
    // was cut from, and — when those bytes will not come — writes the
    // document's own record of the lane back rather than letting the autosave
    // save the loss. Both need the lane's own setters, which App never handed
    // over: the hook could only ever clear the track.
    setSourceAudioName, setSourceAudioDuration, setSourceAudioStart, setSourceAudioSource, sourceAudioSource,
    setTimelineHorizon,
    setVisualSegments, setVisualOverlaySegments, setSelectedVisualOverlayId, setVolume, setCurrentVisualAsset, sourceAudioBlob, sourceAudioDuration,
    markTimelineViewRestored: (hasContent) => { timelineImportRestoreRef.current = hasContent; },
    sourceAudioAssetId, sourceAudioLinked, sourceAudioName, sourceAudioStart, sourceAudioVolume, sourceAudioSpatialEffect, sourceAudioSpatialAmount, speed, stickerSegments,
    projectName, timelineZoom, trackLocks, trackVisibility, visualSegments, visualOverlaySegments, volume,
  });
  const [, commitHostImport] = useState(0);
  const hostProjectApiRef = useRef({ getProjectSnapshot, handleImportProject, acceptProjectBaseline, ratioId, hostProjectTitle });
  hostProjectApiRef.current = { getProjectSnapshot, handleImportProject, acceptProjectBaseline, ratioId, hostProjectTitle };
  useEffect(() => {
    if (!hostBridge) return undefined;
    return hostBridge.connect({
      importProject: async (file, context) => {
        hostImportInProgressRef.current = true;
        try {
          await hostProjectApiRef.current.handleImportProject(file, context);
          // Called from the bridge's async queue, outside React's render and
          // effects. A resolved decoder is not a committed editor snapshot.
          flushSync(() => commitHostImport(value => value + 1));
        } finally {
          hostImportInProgressRef.current = false;
          timelineImportRestoreRef.current = false;
        }
      },
      getProjectSnapshot: () => hostProjectApiRef.current.getProjectSnapshot(),
      setDocumentBusy: setHostDocumentBusy,
      acceptProjectBaseline: (project) => hostProjectApiRef.current.acceptProjectBaseline(project),
      // FORK: the host's render into the project reports through the same
      // toast the browser export uses, so a person sees one kind of message.
      notify: (notice) => notify(typeof notice === "string" ? notice : String(notice?.message || "")),
      // FORK: speak one caption for the host. Outcome by what the editor then
      // holds — the voice hook reports its own failures through status and
      // never throws — read after a tick so React has flushed the commit.
      // FORK: where the playhead is. The host places the board's material at
      // it — "put this on the timeline" means here, not at zero.
      playheadSeconds: () => Number(currentTimeRef.current) || 0,
      // FORK: which clip the host's version picker is about. Only the tracks
      // whose clips stand for one file each — a shot, a voice, the bed.
      selectedClip: () => {
        const selection = hostSelectionRef.current || {};
        if (selection.selectedTrack === "image" && selection.selectedVisualSegmentId) {
          return { clipId: selection.selectedVisualSegmentId, track: "visuals" };
        }
        if (selection.selectedTrack === "audio" && selection.selectedAudioSegmentId) {
          return { clipId: selection.selectedAudioSegmentId, track: "audio" };
        }
        if (selection.selectedTrack === "music" && selection.musicSegments?.[0]?.id) {
          return { clipId: selection.musicSegments[0].id, track: "music" };
        }
        return null;
      },
      generateVoiceover: async (captionId) => {
        const before = hostVoiceRef.current;
        const caption = before.captionSegments.find((item) => item.id === captionId);
        if (!caption) return { status: "missing" };
        if (before.status === "generating" || before.status === "captioning") return { status: "busy" };
        try {
          await before.generateVoiceover(caption);
        } catch (error) {
          return { status: "failed", message: String(error?.message || error) };
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        const after = hostVoiceRef.current;
        if (after.status === "error") return { status: "failed", message: String(after.statusText || "") };
        const spoken = after.captionSegments.find((item) => item.id === captionId);
        // A generated voice lands DETACHED from its caption: the editor sets
        // `detachedAudioSegmentId` so a person editing one line can rewrite it
        // without the audio following. Either id means the voice is there —
        // reading only `audioSegmentId` reported a failure for every line that
        // worked. A host asking for a whole script wants the other default:
        // the caption should move with its voice, so link it here, in the same
        // state the editor is about to autosave. Doing it from the host
        // afterwards raced that save and wiped the line it had not seen yet.
        const clipId = spoken?.audioSegmentId || spoken?.detachedAudioSegmentId;
        if (!clipId) return { status: "failed", message: String(after.statusText || "") };
        if (!spoken.audioSegmentId) {
          after.setCaptionSegments((segments) => segments.map((item) => item.id === captionId
            ? { ...item, audioSegmentId: clipId, detachedAudioSegmentId: "" }
            : item));
        }
        return { status: "done", message: clipId };
      },
      updateAuthorizedAssets: (assets) => {
        // FORK: keep the list itself, not only what merging makes of it.
        hostAuthorizedAssetsRef.current = Array.isArray(assets) ? assets : [];
        setUserAssets((current) => mergeAuthorizedUserAssets(current, assets));
      },
      updateProjectFiles: (files) => {
        setUserAssets((current) => mergeProjectFileUserAssets(current, files));
      },
      updateProjectMetadata: (metadata) => {
        setProjectName(String(metadata?.title || hostProjectApiRef.current.hostProjectTitle || "").trim());
        // FORK: adopt the production's authored aspect. The editor otherwise
        // opens on its own default and exports at that default, so a 9:16
        // production could render landscape without anything saying so. Only
        // on a real change — assigning the same id would fight the
        // auto-switch-from-media effect in useEditorLifecycle.
        const hostAspect = metadata?.aspect;
        if (hostAspect && RATIO_OPTIONS.some((option) => option.id === hostAspect) && hostAspect !== hostProjectApiRef.current.ratioId) {
          setRatioId(hostAspect);
        }
      },
    });
  }, [hostBridge, setRatioId]);
  useEffect(() => {
    if (!hostBridge) return;
    hostBridge.onProjectSnapshot(hostProjectApiRef.current.getProjectSnapshot());
  }, [autosaveRevision, hostBridge]);

  const {
    activeTimelineClipDrag, audioClipPercent, displayedCaptionSegments,
    displayedCaptionTimeline, displayedVisualSegments, exportPercent, musicClipPercent, musicStartPercent,
    playheadPercent, previewFrameStyle, previewRatio, progressPercent,
    renderedVisualSegments, renderedVisualTimeline, showStickerTrack,
    sourceAudioClipPercent, sourceAudioStartPercent,
  } = createTimelineViewModel({
    assetDragPreview, assetDropTargetTrack, audioBlob, audioDuration, captionSegments,
    captionTargetDuration, captionTimeline, currentTime, draggedAssetId, exportProgress,
    findAssetById, getCurrentVisualAssetSnapshot, imageDuration, imageSrc, musicBlob,
    musicDuration, musicStart, previewFrameSize, progress, ratio, selectedTrack, sourceAudioBlob,
    linkedSourceAudioSegments, sourceAudioDuration, sourceAudioLinked, sourceAudioStart, stickerSegments, timelineClipDrag,
    timelineDuration, visualSegments,
  });
  const exportContentDuration = useMemo(() => getExportContentDuration({
    visualDuration: imageDuration,
    voiceDuration: voiceTrackDuration,
    captionDuration,
    sourceAudioDuration: sourceAudioBlob ? sourceAudioTimelineEnd : 0,
    musicDuration: musicBlob ? musicTimelineEnd : 0,
    stickerDuration,
    overlaySegments: visualOverlaySegments,
  }), [
    captionDuration, imageDuration, musicBlob, musicTimelineEnd, sourceAudioBlob,
    sourceAudioTimelineEnd, stickerDuration, visualOverlaySegments, voiceTrackDuration,
  ]);
  const handleExportVideo = useVideoExport({
    audioSegments, captionDuration, captionPlacement, captionPosition, captionSegments, captionTargetDuration,
    captionSize, captionStyle, captionsEnabled, exporting, exportAbortControllerRef, exportStartRef, fitMode,
    imageDuration, imageSrc, musicBlob, musicDuration, musicSegments, musicStart, musicTimelineEnd, musicVolume, notify,
    previewFrameSize, projectName, ratio, renderedVisualSegments, script, selectedFilter,
    selectedSticker, selectedTransitionId, setExporting, setExportPhase,
    setExportProgress, setStatus, setStatusText, sourceAudioBlob, sourceAudioAssetId, sourceAudioDuration,
    linkedSourceAudioSegments, sourceAudioLinked, sourceAudioStart, sourceAudioTimelineEnd, sourceAudioVolume, sourceAudioSpatialEffect, sourceAudioSpatialAmount, stickerDuration, stickerSegments,
    trackVisibility, visionRecords, depthRecords, visualType, voiceTrackDuration, volume, exportSettings: {
      ...exportSettings,
      ...getExportDimensions(ratio, Number(exportSettings.resolution)),
      videoBitsPerSecond: getEffectiveExportBitrate(exportSettings),
    },
    visualOverlaySegments, t,
    // FORK: the host keeps the export, when it offers to. In VibeDev the
    // download folder is outside the product: the file the person just made
    // belongs in their project, on the board, beside what it was made from.
    hostBridge,
    // FORK: what the host authorized, so the export can read the voice clips
    // it placed. They play from a URL and hold no Blob; a mix needs the bytes.
    hostAuthorizedAssetsRef,
  });
  const { startCaptionResize, startTimelineClipDrag } = createTimelineReorderControls({
    audioSegments, captionSegments, captionTargetDuration, commitCaptionSegments, commitVisualSegments,
    notify, renderedVisualSegments, seekTo, setSelectedSegmentId, setSelectedTrack,
    setSelectedVisualSegmentId, setTimelineClipDrag, suppressTimelineClipClickRef,
    timelineClipDragRef, timelineDuration, trackLocks, visualSegments, pauseForTimelineEdit,
    setTimelineHorizon,
    stickerSegments, sourceAudioDuration, sourceAudioStart, musicDuration, musicStart, musicSegments, currentTime, setSnapGuide,
    visualOverlaySegments, setVisualOverlaySegments, setSelectedVisualOverlayId, trackScrollRef,
  });

  return (
    <main inert={hostDocumentBusy ? true : undefined} aria-busy={hostDocumentBusy} ref={appShellRef} className={`app-shell ${isCompactViewport ? "is-compact-workspace" : ""} ${mobilePanel ? `mobile-panel-${mobilePanel}` : ""} ${isCompactViewport && mobileInspectorSection ? `mobile-section-${mobileInspectorSection}` : ""} ${isCompactViewport && mobileInspectorSection === "mask" && (selectedVisualOverlay || selectedVisualSegment)?.mask?.type && (selectedVisualOverlay || selectedVisualSegment).mask.type !== "none" ? "mobile-mask-active" : ""} ${mobilePanelClosing ? "is-mobile-panel-closing" : ""}`} lang={activeLanguage} onDragOver={(event) => {
      if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
    }} onDrop={async (event) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!files.length) return;
      event.preventDefault();
      const audioFile = files.find((file) => file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg)$/i.test(file.name));
      const targetTrack = event.target.closest?.("[data-asset-drop-track]")?.dataset.assetDropTrack;
      if (audioFile && targetTrack === "music") {
        try {
          const decoded = await decodeWaveform(audioFile, 96);
          replaceMusic(audioFile, decoded.duration, decoded.peaks, audioFile.name, "音乐已安全加入时间线");
        } catch (error) {
          notify(error instanceof Error ? `无法读取该音频：${error.message}` : "无法读取该音频文件");
        }
        return;
      }
      handleFiles(files);
    }}>
      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,video/x-matroska,.mkv,.mka,audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg,audio/flac,.ac3"
        multiple
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
          event.target.blur();
        }}
      />
      <Topbar
        t={t}
        hostBridge={hostBridge}
        projectName={projectName || t("projectTitle")}
        exportNameFallback={projectName}
        compactRail={compactRail}
        setCompactRail={setCompactRail}
        lastSaved={lastSaved}
        undo={undo}
        redo={redo}
        ratio={ratio}
        ratioId={ratioId}
        showRatioMenu={showRatioMenu}
        setShowRatioMenu={setShowRatioMenu}
        setRatioId={(nextRatioId) => {
          setRatioId(nextRatioId);
          setFitModeFromUser("contain");
        }}
        notify={notify}
        isPlaying={isPlaying}
        handlePlayToggle={handlePlayToggle}
        imageSrc={imageSrc}
        exporting={exporting}
        handleExportVideo={handleExportVideo}
        showExportMenu={showExportMenu}
        setShowExportMenu={setShowExportMenu}
        exportSettings={exportSettings}
        setExportSettings={setExportSettings}
        timelineDuration={exportContentDuration}
        showSettings={showSettings}
        setShowSettings={setShowSettings}
        activeLanguage={activeLanguage}
        setUiLanguage={setUiLanguage}
        captionsEnabled={captionsEnabled}
        setCaptionsEnabled={setCaptionsEnabled}
        trackVisibility={trackVisibility}
        toggleTrackVisibility={toggleTrackVisibility}
        showFileMenu={showFileMenu}
        setShowFileMenu={setShowFileMenu}
        handleNewProject={handleNewProject}
        handleExportProject={handleExportProject}
        handleImportProject={handleImportProject}
        projectFileInputRef={projectFileInputRef}
      />

      <section className={`editor-grid ${compactRail ? "is-compact-rail" : ""}`}>
        <EditorSidebar model={{
          activeLanguage, activeTool, analyzeCurrentVisual, analyzeEffectVisual, audioBlob, audioDuration,
          builtInAssets, captionPosition, captionSegments, captionSize, captionStyle, applyCaptionPositionToAll, trackLocks,
          captionTargetDuration, captionsEnabled, clearMusicTrack, clearSourceAudioTrack,
          compactRail, currentSegmentIndex, deleteCaptionSegment,
          deleteUserAsset, downloadBlob, draggedAssetId,
          estimatedDuration, fileInputRef, generateCaptionsFromSourceAudio, handleAssetClick,
          handleAssetPointerDown, handleCaptionPositionChange, handleFiles, handleStickerClick, confirmStickerSelection,
          imageSrc, isDragging, mediaTab, musicBlob, musicDuration, musicName, musicVolume,
          libraryType, libraryQuery, setLibraryQuery, selectLibraryType, libraryStatus, libraryError, libraryProvider, libraryCategories,
          assetDownloadStates, prefetchLibraryAsset,
          notify, openAvatarPanel, previewVisionAnalysis, previewVisionKey, smartMode, setSmartMode,
          previewVisionOptions, previewVisualSrc, previewVisualType, progress, script,
          seekTo, segments, selectTool, selectedCaptionSegment, selectedFilterId,
          selectedLibraryAssetId, selectedSegmentId, selectedStickerId, selectedTransitionId,
          selectedVoice: selectedVoiceProfile ? { ...selectedVoice, name: selectedVoiceProfile.name } : selectedVoice,
          setCaptionSegments, setCaptionSize, setCaptionStyle, setCaptionsEnabled, setIsDragging,
          setMediaTab, setMusicVolume, setSelectedAudioSegmentId, setSelectedFilterId, setSelectedSegmentId,
          setSelectedStickerId, setSelectedTrack, setSelectedTransitionId, setSourceAudioVolume, setVoiceTab,
          sourceAudioBlob, sourceAudioDuration, sourceAudioLinked, sourceAudioName, sourceAudioVolume, status, t,
          selectedAudioToolTarget, separateSelectedAudioVocals, separateSourceVocals, vocalSeparationJob,
          toggleCaptionSegmentHidden, trOption, updateCaptionSegmentText,
          updateScript, userAssets, visionJob, aiMusic, smartFrame,
          selectedVisualSegment, selectedEffectSegment, effectAnalysis, effectRunning, effectProgress, effectPhase,
          effectsPanelMode, setEffectsPanelMode, cinematicDepth, photoParallaxDepth,
          visualLocalTime, updateSelectedVisualEffects, updateSelectedSubjectEffect, removeSelectedSubjectEffect, miganRepair, hdRestoration,
          mobilePanel, setMobilePanel: changeMobilePanel, applyAssetToTrack, handleGeneratedVector,
          isCompactViewport, isMobileViewport,
        }} />

        <PreviewStage
          t={t}
          previewShellRef={previewShellRef}
          onPreviewShellChange={setPreviewShellNode}
          previewCanvasRef={previewCanvasRef}
          previewVideoRef={previewVideoRef}
          onPreviewVideoChange={attachPreviewVideo}
          onPreviewVideoTimeUpdate={previewVisionBaseAnalysis?.kind === "video-timeline" ? setPreviewVideoMediaTime : undefined}
          previewVisualSrc={previewVisualSrc}
          previewVisualRenderSrc={previewVisualRenderSrc}
          previewVisionMaskUrl={previewVisionMaskUrl}
          previewVisualType={previewVisualType}
          previewVisualMuted={trackVisibility.source === false || shouldMuteEmbeddedVideoAudio(previewVisualSegment, {
            sourceAudioBlob,
            sourceAudioAssetId,
            visualSegments,
            linkedSegments: linkedSourceAudioSegments,
          })}
          previewTransition={previewTransition}
          visualEffects={visualAnimationPreview?.segmentId && visualAnimationPreview.segmentId === previewVisualSegment?.id
            ? { ...previewVisualSegment, animation: visualAnimationPreview.animation }
            : previewVisualSegment}
          subjectEffect={previewVisualSegment?.subjectEffect}
          subjectCutoutUrl={previewVisionAnalysis?.cutoutUrl || ""}
          cinematicDepth={previewVisualSegment?.cinematicDepth}
          photoParallax={previewVisualSegment?.photoParallax}
          depthAnalysis={previewDepthAnalysis}
          visualLocalTime={visualAnimationPreview?.segmentId && visualAnimationPreview.segmentId === previewVisualSegment?.id
            ? visualAnimationPreview.localTime
            : previewVisualLocalTime}
          visualMaskEditable={selectedTrack === "image" && Boolean(selectedVisualSegment) && visualCanvasEditMode === "mask"}
          onUpdateVisualMask={(mask) => updateSelectedVisualEffects({ mask })}
          visualTransformEditable={canvasVisualTarget === `visual:${previewVisualSegment?.id ?? ""}` && visualCanvasEditMode !== "mask" && !isPlaying}
          onSelectVisual={() => {
            if (!previewVisualSegment?.id) return;
            setSelectedVisualSegmentId(previewVisualSegment.id);
            setSelectedTrack("image");
            setCanvasVisualTarget(`visual:${previewVisualSegment.id}`);
          }}
          onDeselectVisuals={() => {
            setCanvasVisualTarget("");
          }}
          onUpdateVisualTransform={(transform) => updateSelectedVisualEffects({ baseTransform: transform })}
          previewRatio={previewRatio}
          previewFrameStyle={previewFrameStyle}
          previewFrameSize={previewFrameSize}
          trackVisibility={trackVisibility}
          fileInputRef={fileInputRef}
          selectedFilter={activePreviewFilter}
          fitMode={fitMode}
          ratioId={ratioId}
          setRatioId={(nextRatioId) => {
            setRatioId(nextRatioId);
            setFitModeFromUser("contain");
          }}
          visualObjectFit={previewVisualObjectFit}
          visualObjectPosition={previewVisualObjectPosition}
          backgroundRemoved={
            previewVisionOptions.removeBackground &&
            Boolean(previewVisionAnalysis?.cutoutUrl)
          }
          smartCropActive={Boolean(previewSmartCropRect)}
          smartFramePresentation={previewSmartCropRect?.presentation}
          smartFrameBackgroundPosition={previewSmartBackgroundPosition}
          setFitMode={setFitModeFromUser}
          captionsEnabled={captionsEnabled}
          currentCaption={currentCaption}
          currentCaptions={currentCaptions}
          captionSize={captionSize}
          captionStyle={captionStyle}
          captionPlacement={effectiveCaptionPlacement}
          startCaptionDrag={startCaptionDrag}
          setActiveTool={setActiveTool}
          selectedSticker={previewSticker}
          stickers={previewStickers}
          selectedStickerId={selectedStickerSegment?.id ?? ""}
          stickerEditable
          onSelectSticker={selectCanvasStickerSegment}
          onUpdateSticker={updateCanvasStickerSegment}
          isPlaying={isPlaying}
          canPreview={canPreview}
          handlePlayToggle={handlePlayToggle}
          estimatedDuration={estimatedDuration}
          currentTime={currentTime}
          seekTo={seekTo}
          notify={notify}
          getDraggedAsset={getDraggedAsset}
          applyAssetToTrack={applyAssetToTrack}
          addVisualOverlay={addVisualOverlay}
          visualOverlays={previewVisualOverlaysWithDepth}
          selectedVisualOverlayId={canvasVisualTarget === `overlay:${selectedVisualOverlayId}` ? selectedVisualOverlayId : ""}
          onSelectVisualOverlay={(id) => {
            setSelectedVisualOverlayId(id);
            setSelectedVisualSegmentId("");
            setSelectedTrack("overlay");
            setCanvasVisualTarget(`overlay:${id}`);
          }}
          onUpdateVisualOverlay={updateVisualOverlayById}
          visualOverlayMaskEditable={visualCanvasEditMode === "mask"}
          onUpdateVisualOverlayMask={(mask) => updateSelectedVisualOverlayEffects({ mask })}
          onReorderVisualOverlay={(id, direction) => setVisualOverlaySegments((items) => {
            const ordered = [...items].sort((a, b) => (a.layer || 1) - (b.layer || 1));
            const index = ordered.findIndex((item) => item.id === id);
            const target = Math.max(0, Math.min(ordered.length - 1, index + direction));
            if (index < 0 || index === target) return items;
            [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
            return ordered.map((item, layer) => ({ ...item, layer: layer + 1 }));
          })}
        />

        <VoicePanel
          t={t}
          activeTool={activeTool}
          captionVoiceFocusRequest={captionVoiceFocusRequest}
          status={status}
          statusText={statusText}
          voiceTab={voiceTab}
          setVoiceTab={setVoiceTab}
          script={script}
          updateScript={updateScript}
          selectedVoiceId={selectedVoiceId}
          setSelectedVoiceId={setSelectedVoiceId}
          selectedVoice={selectedVoice}
          filteredVoices={filteredVoices}
          voiceFilter={voiceFilter}
          setVoiceFilter={setVoiceFilter}
          showVoiceFilter={showVoiceFilter}
          setShowVoiceFilter={setShowVoiceFilter}
          speed={speed}
          setSpeed={setSpeed}
          volume={volume}
          setVolume={setVolume}
          progressPercent={progressPercent}
          audioBlob={audioBlob}
          generateVoiceover={generateVoiceover}
          downloadBlob={downloadBlob}
          favoriteVoiceIds={favoriteVoiceIds}
          setFavoriteVoiceIds={setFavoriteVoiceIds}
          voiceProfiles={voiceProfiles}
          addVoiceProfile={addVoiceProfile}
          removeVoiceProfile={removeVoiceProfile}
          toggleVoiceProfileFavorite={toggleVoiceProfileFavorite}
          selectedVoiceProfileId={selectedVoiceProfileId}
          setSelectedVoiceProfileId={setSelectedVoiceProfileId}
          recordedVoices={recordedVoices}
          recordingState={recordingState}
          recordingElapsed={recordingElapsed}
          startVoiceRecording={startVoiceRecording}
          stopVoiceRecording={stopVoiceRecording}
          historyItems={historyItems}
          useHistoryItem={useHistoryItem}
          setHistoryItems={setHistoryItems}
          notify={notify}
          audioUrl={audioUrl}
          audioRef={audioRef}
          audioSegments={audioSegments}
          audioSegmentRefs={audioSegmentRefs}
          sourceAudioRef={sourceAudioRef}
          musicRef={musicRef}
          sourceAudioUrl={sourceAudioUrl}
          musicUrl={musicUrl}
          captionSegments={captionSegments}
          selectedCaptionSegment={selectedCaptionSegment}
          selectedSegmentId={selectedSegmentId}
          setSelectedSegmentId={setSelectedSegmentId}
          currentSegmentIndex={currentSegmentIndex}
          captionTargetDuration={captionTargetDuration}
          updateCaptionSegmentText={updateCaptionSegmentText}
          alignCaptionToAudio={alignCaptionToAudio}
          linkCaptionAudio={linkCaptionAudio}
          unlinkCaptionAudio={unlinkCaptionAudio}
          toggleCaptionSegmentHidden={toggleCaptionSegmentHidden}
          deleteCaptionSegment={deleteCaptionSegment}
          importCaptionSegments={importCaptionSegments}
          addCaptionSegment={handleAddCaptionSegment}
          currentTime={currentTime}
          seekTo={seekTo}
          sourceAudioBlob={sourceAudioBlob}
          sourceAudioLinked={sourceAudioLinked}
          timelineCaptions={Boolean(hostBridge?.capabilityRuntime?.transcribeTimeline)}
          generateCaptionsFromSourceAudio={generateCaptionsFromSourceAudio}
          isGeneratingCaptions={status === "captioning"}
          automaticCaptionProgress={status === "captioning" ? progress : 0}
          avatarPanelOpen={avatarPanelOpen}
          smartMode={smartMode}
          aiMusic={aiMusic}
          autoEdit={autoEdit}
          uiLanguage={activeLanguage}
          captionStyle={captionStyle}
          setCaptionStyle={setCaptionStyle}
          setCaptionSegments={setCaptionSegments}
          smartFrame={smartFrame}
          analyzeCurrentVisual={analyzeCurrentVisual}
          analyzeEffectVisual={analyzeEffectVisual}
          hasVisual={Boolean(previewVisualSrc)}
          visualType={previewVisualType}
          audioDuration={audioDuration}
          avatarJob={avatarJob}
          generateAvatarAcceptanceFrame={generateAvatarAcceptanceFrame}
          faceSwap={faceSwap}
          selectedTrack={selectedTrack}
          selectedAudioSegment={selectedAudioSegment}
          selectedTrackAudioSegment={selectedAudioToolTarget}
          mobileInspectorOrigin={mobilePanel === "inspector" ? mobilePanelOrigin : ""}
          mobileInspectorSection={isCompactViewport && mobilePanel === "inspector" ? mobileInspectorSection : ""}
          onCloseMobileInspector={() => changeMobilePanel("")}
          updateSelectedTrackAudioSegment={updateSelectedTrackAudioSegment}
          deleteSelectedTrackAudioSegment={() => handleDeleteTrack()}
          updateAudioSegment={updateAudioSegment}
          toggleAudioSegmentReverse={toggleAudioSegmentReverse}
          deleteAudioSegment={deleteAudioSegment}
          processingRuntime={hostBridge?.capabilityRuntime}
          voiceColorAuthorizedAssets={hostAuthorizedAssetsRef.current}
          onVoiceColorAssetReady={handleVoiceColorAssetReady}
          onApplyVoiceColor={applyVoiceColorToSelectedAudio}
          onRestoreVoiceColor={restoreSelectedAudioVoiceColor}
          selectedVisualSegment={selectedVisualSegment}
          selectedStickerSegment={selectedStickerSegment}
          updateStickerSegment={updateSelectedStickerSegment}
          deleteStickerSegment={deleteSelectedStickerSegment}
          visualLocalTime={visualLocalTime}
          visualTimelineStart={selectedVisualRange?.start ?? 0}
          updateSelectedVisualEffects={updateSelectedVisualEffects}
          miganRepair={miganRepair}
          hdRestoration={hdRestoration}
          onPreviewAnimation={setVisualAnimationPreview}
          selectedFilterId={selectedFilterId}
          setSelectedFilterId={setSelectedFilterId}
          trOption={trOption}
          selectedVisualOverlay={selectedVisualOverlay}
          updateVisualOverlaySegment={(patch) => setVisualOverlaySegments((items) => items.map((item) => item.id === selectedVisualOverlayId ? { ...item, ...patch } : item))}
          updateVisualOverlayEffects={updateSelectedVisualOverlayEffects}
          setVisualCanvasEditMode={setVisualCanvasEditMode}
          deleteVisualOverlay={() => handleDeleteTrack()}
          applyVisualOverlayPreset={(id) => {
            const preset = getVisualOverlayPreset(id);
            if (preset) updateSelectedVisualOverlay(preset);
          }}
          effectSegment={selectedEffectSegment}
          effectAnalysis={effectAnalysis}
          effectRunning={effectRunning}
          effectProgress={effectProgress}
          effectPhase={effectPhase}
          effectsPanelMode={effectsPanelMode}
          cinematicDepth={cinematicDepth}
          updateSelectedCinematicDepth={updateSelectedCinematicDepth}
          photoParallaxDepth={photoParallaxDepth}
          updateSelectedPhotoParallax={updateSelectedPhotoParallax}
          updateSelectedSubjectEffect={updateSelectedSubjectEffect}
          removeSelectedSubjectEffect={removeSelectedSubjectEffect}
          onOpticalFlowAssetReady={handleOpticalFlowAssetReady}
        />
      </section>

      <Timeline
        isMobileViewport={isMobileViewport}
        isNarrowMobileViewport={isNarrowMobileViewport}
        t={t}
        trOption={trOption}
        notify={notify}
        undo={undo}
        redo={redo}
        handleDeleteTrack={handleDeleteTrack}
        handleDuplicateTrack={handleDuplicateTrack}
        handleCutTrack={handleCutTrack}
        canPreview={canPreview}
        handlePlayToggle={handlePlayToggle}
        isPlaying={isPlaying}
        handleAddSegment={handleAddSegment}
        handleRemoveSegment={handleRemoveSegment}
        adjustSelectedSegmentWeight={adjustSelectedSegmentWeight}
        timelineZoom={timelineZoom}
        setTimelineZoom={setTimelineZoom}
        selectedTrack={selectedTrack}
        setSelectedTrack={setSelectedTrack}
        setActiveTool={setActiveTool}
        openMobileInspector={(track, section = "") => {
          setMobilePanelOrigin(getMobileClipPanelOrigin(track));
          setMobileInspectorSection(section);
          changeMobilePanel("inspector");
        }}
        openMobileTools={() => changeMobilePanel("tools")}
        openMobileFilePicker={() => fileInputRef.current?.click()}
        requestCaptionVoiceFocus={() => setCaptionVoiceFocusRequest((request) => request + 1)}
        alignCaptionToAudio={alignCaptionToAudio}
        linkCaptionAudio={linkCaptionAudio}
        unlinkCaptionAudio={unlinkCaptionAudio}
        linkAllCaptionAudio={linkAllCaptionAudio}
        unlinkAllCaptionAudio={unlinkAllCaptionAudio}
        alignAudioCaptions={alignAudioCaptions}
        linkAudioToCaption={linkAudioToCaption}
        unlinkAudioCaptions={unlinkAudioCaptions}
        trackVisibility={trackVisibility}
        toggleTrackVisibility={toggleTrackVisibility}
        trackLocks={trackLocks}
        toggleTrackLock={toggleTrackLock}
        trackScrollRef={trackScrollRef}
        startTimelineSeek={startTimelineSeek}
        timelineDuration={timelineDuration}
        timelineContentDuration={Math.max(estimatedDuration, timelineHorizon)}
        setTimelineHorizon={setTimelineHorizon}
        currentTime={currentTime}
        playheadPercent={playheadPercent}
        snapGuide={snapGuide}
        setSnapGuide={setSnapGuide}
        assetDropTargetTrack={assetDropTargetTrack}
        assetDropPosition={assetDropPosition}
        assetDropPulseTrack={assetDropPulseTrack}
        assetDragPreview={assetDragPreview}
        draggedAssetType={getActiveDraggedAsset()?.type || assetDragPreview?.type || ""}
        handleTrackAssetDragOver={handleTrackAssetDragOver}
        handleTrackAssetDragLeave={handleTrackAssetDragLeave}
        handleTrackAssetDrop={handleTrackAssetDrop}
        handleVisualStyleDrop={handleVisualStyleDrop}
        activeTimelineClipDrag={activeTimelineClipDrag}
        showStickerTrack={showStickerTrack}
        stickerSegments={stickerSegments}
        setStickerSegments={setStickerSegments}
        currentStickerSegment={currentStickerSegment}
        selectedStickerSegmentId={selectedStickerSegmentId}
        setSelectedStickerSegmentId={setSelectedStickerSegmentId}
        stickerTimelineDrag={stickerTimelineDrag}
        imageSrc={imageSrc}
        displayedVisualSegments={displayedVisualSegments}
        setVisualSegments={setVisualSegments}
        renderedVisualTimeline={renderedVisualTimeline}
        visualType={visualType}
        currentVisualSegment={currentVisualSegment}
        selectedVisualSegmentId={selectedVisualSegmentId}
        currentVisualSegmentIndex={currentVisualSegmentIndex}
        visualOverlaySegments={visualOverlaySegments}
        selectedVisualOverlayId={selectedVisualOverlayId}
        setSelectedVisualOverlayId={setSelectedVisualOverlayId}
        setVisualOverlaySegments={setVisualOverlaySegments}
        builtInImageCaptionAvailable={autoEdit.support.availability === "available"}
        generateImageCaption={autoEdit.generateImageCaption}
        extractVideoSourceAudio={extractVideoSourceAudio}
        sendAudioToCanvas={sendAudioToCanvas}
        audioSending={audioSending}
        generateCaptionsFromAudioClip={generateCaptionsFromSourceAudio}
        separateAudioClipVocals={separateAudioClipVocals}
        audioProcessingBusy={vocalSeparationJob.running || status === "captioning"}
        setSelectedVisualSegmentId={setSelectedVisualSegmentId}
        seekTo={seekTo}
        suppressTimelineClipClickRef={suppressTimelineClipClickRef}
        startTimelineClipDrag={startTimelineClipDrag}
        startCaptionResize={startCaptionResize}
        startImageResize={startImageResize}
        startStickerSegmentMove={startStickerSegmentMove}
        startStickerSegmentResize={startStickerSegmentResize}
        displayedCaptionSegments={displayedCaptionSegments}
        displayedCaptionTimeline={displayedCaptionTimeline}
        setCaptionSegments={setCaptionSegments}
        currentCaptionSegment={currentCaptionSegment}
        selectedSegmentId={selectedSegmentId}
        setSelectedSegmentId={setSelectedSegmentId}
        captionTargetDuration={captionTargetDuration}
        sourceAudioLinked={sourceAudioLinked}
        linkedSourceAudioSegments={linkedSourceAudioSegments}
        sourceAudioBlob={sourceAudioBlob}
        sourceAudioPeaks={sourceAudioPeaks}
        sourceAudioClipPercent={sourceAudioClipPercent}
        sourceAudioStartPercent={sourceAudioStartPercent}
        sourceAudioDuration={sourceAudioDuration}
        sourceAudioDragTargetLane={sourceAudioDragTargetLane}
        setSourceAudioStart={setSourceAudioStart}
        selectedSourceAudioSegmentId={selectedSourceAudioSegmentId}
        setSelectedSourceAudioSegmentId={setSelectedSourceAudioSegmentId}
        audioBlob={audioBlob}
        peaks={peaks}
        audioClipPercent={audioClipPercent}
        audioDuration={audioDuration}
        audioSegments={audioSegments}
        setAudioSegments={setAudioSegments}
        selectedAudioSegmentId={selectedAudioSegmentId}
        setSelectedAudioSegmentId={setSelectedAudioSegmentId}
        startAudioSegmentMove={startAudioSegmentMove}
        startSourceAudioMove={startSourceAudioMove}
        musicBlob={musicBlob}
        musicSegments={musicSegments}
        setMusicSegments={setMusicSegments}
        setMusicStart={setMusicStart}
        selectedMusicSegmentId={selectedMusicSegmentId}
        setSelectedMusicSegmentId={setSelectedMusicSegmentId}
        musicPeaks={musicPeaks}
        musicStartPercent={musicStartPercent}
        musicDuration={musicDuration}
        startMusicMove={startMusicMove}
      />

      {mobilePanel && !(mobilePanel === "inspector" && isCompactViewport && mobileInspectorSection) ? (
        <header className="mobile-sheet-nav">
          <strong>{({
            transform: t("visualTabTransform"),
            mask: t("visualTabMask"),
            filters: t("visualTabEffects"),
            animation: t("visualTabAnimation"),
            speed: t("visualTabSpeed"),
            vector: t("vectorProperties", "矢量"),
            timing: t("overlayTiming", "层级与时长"),
            repair: t("repairTab"),
            effects: t("effects"),
            caption: t("caption"),
            voice: t("aiVoice"),
            audio: t("mobileClipAudio"),
            fade: t("mobileClipFade"),
            "voice-color": t("voiceColorTab", "音色"),
            sticker: t("stickerProperties"),
          }[mobileInspectorSection]) || (mobilePanelOrigin === "audio-clip"
            ? t("audioClipProperties")
            : mobilePanelOrigin === "sticker-clip"
              ? t("stickerProperties")
              : mobilePanelOrigin === "visual-clip"
                ? t("visualPanelTitle")
                : mobilePanelOrigin === "overlay-clip"
                  ? t("pictureInPicture", "画中画")
                  : mobilePanelOrigin === "caption-clip"
                    ? t("caption")
                    : t(activeTool))}</strong>
          <div className="mobile-sheet-nav-actions">
            {!mobilePanelOrigin.endsWith("-clip") ? <div className="mobile-sheet-tabs" role="tablist" aria-label={t("mobilePanelView")}>
              <button className={mobilePanel === "tools" ? "is-active" : ""} type="button" role="tab" aria-selected={mobilePanel === "tools"} onClick={() => changeMobilePanel("tools")}>{t("mobileDrawerTools")}</button>
              <button className={mobilePanel === "inspector" ? "is-active" : ""} type="button" role="tab" aria-selected={mobilePanel === "inspector"} onClick={() => changeMobilePanel("inspector")}>{t("properties")}</button>
            </div> : null}
            <button className="mobile-sheet-close" type="button" aria-label={t("close", "关闭")} onClick={() => changeMobilePanel("")}><X size={20} /></button>
          </div>
        </header>
      ) : null}
      {mobilePanel ? <button className="mobile-sheet-backdrop" type="button" aria-label={t("close", "关闭")} onClick={() => changeMobilePanel("")} /> : null}

      <AssetDragPreview preview={assetDragPreview} t={t} />
      <MiganRepairDialog
        repair={miganRepair}
        segment={selectedVisualSegment}
        t={t}
        onApplied={() => changeMobilePanel("")}
      />
      <NanoVsrRestorationDialog
        restoration={hdRestoration}
        segment={hdRestoration.sourceSegment || selectedVisualSegment}
        t={t}
        onApplied={() => changeMobilePanel("")}
      />
      <ExportProgressOverlay
        exporting={exporting}
        percent={exportPercent}
        phase={exportPhase}
        elapsedSeconds={exportElapsedSeconds}
        onCancel={handleCancelExport}
        canceling={exportPhase === t("exportCanceling")}
        t={t}
      />
      {showFirstVisualGuide && !shouldShowLanguageIntro ? (
        <FirstVisualGuide
          language={activeLanguage}
          onClose={() => setShowFirstVisualGuide(false)}
          onComplete={() => {
            markFirstVisualGuideSeen();
            setShowFirstVisualGuide(false);
          }}
        />
      ) : null}
      {shouldShowLanguageIntro ? (
        <LanguageIntro t={t} closing={introClosing} onChoose={chooseInterfaceLanguage} />
      ) : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </main>
  );
}
