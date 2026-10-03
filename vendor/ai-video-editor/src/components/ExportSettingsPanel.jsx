import { useEffect, useState } from "react";
import { FileArrowDown, FilmSlate } from "@phosphor-icons/react";

import {
  DEFAULT_EXPORT_SETTINGS,
  formatEstimatedFileSize,
  getExportEstimate,
  getExportFormatProfile,
  getExportRuntimeCapabilities,
  getExportTechnicalSummary,
  probeExportRuntimeCapabilities,
} from "../lib/exportSettings.js";

const VIDEO_BITRATE_OPTIONS = [
  ["auto", 0],
  ["5", 5_000_000],
  ["8", 8_000_000],
  ["12", 12_000_000],
  ["20", 20_000_000],
  ["40", 40_000_000],
];

// FORK: frameRate is no longer pinned to 30 here — the panel offers 24/30/60
// and the host render takes the same value.
const SIMPLE_EXPORT_DEFAULTS = Object.freeze({
  quality: "high",
  pipeline: "auto",
  audio: "mix",
  captions: "burned",
  range: "full",
  keyFrameInterval: 2,
});

const withSimpleExportDefaults = (settings) => ({
  ...settings,
  ...SIMPLE_EXPORT_DEFAULTS,
  frameRate: [24, 30, 60].includes(Number(settings?.frameRate)) ? Number(settings.frameRate) : 30,
});

export function ExportSettingsPanel({
  t,
  // FORK: when a host offers its own render, it sits beside the browser export.
  hostBridge = null,
  ratio,
  imageSrc,
  timelineDuration,
  exportSettings,
  setExportSettings,
  handleExportVideo,
  exportNameFallback = "",
  onClose,
}) {
  const summary = getExportTechnicalSummary(exportSettings, ratio);
  const estimate = getExportEstimate({ ...exportSettings, range: "full" }, ratio, timelineDuration);
  const format = getExportFormatProfile(exportSettings.codec);
  const selectedVideoBitrate = exportSettings.bitrateMode === "custom"
    ? String(Math.round((Number(exportSettings.customVideoBitsPerSecond) || 12_000_000) / 1_000_000))
    : "auto";
  const [capabilities, setCapabilities] = useState(() => getExportRuntimeCapabilities());
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let active = true;
    setChecking(true);
    probeExportRuntimeCapabilities(withSimpleExportDefaults(exportSettings), ratio).then((next) => {
      if (!active) return;
      setCapabilities(next);
      setChecking(false);
    });
    return () => { active = false; };
  }, [exportSettings, ratio]);

  const runtimeAvailable = exportSettings.codec === "h264-mov"
    ? capabilities.deterministic
    : capabilities.deterministic || capabilities.compatible;
  const update = (patch) => setExportSettings((current) => withSimpleExportDefaults({ ...current, ...patch }));
  // FORK: the host's render takes the same file name, resolution and frame
  // rate this panel shows, so the two outputs can only differ by where they land.
  const hostRender = hostBridge?.hostActions?.renderToProject || null;
  // FORK: the host takes the browser export's files instead of the download
  // folder; the panel says so beside the button that makes them.
  const hostKeep = hostBridge?.hostActions?.keepExport || null;
  // FORK: the host's pre-flight. A cut the host's renderer refuses is marked
  // here, where the person is about to press the button, with the reason.
  const [hostCheck, setHostCheck] = useState(null);
  useEffect(() => {
    if (!hostRender || typeof hostRender.check !== "function") return undefined;
    let active = true;
    setHostCheck(null);
    hostRender.check({ resolution: String(exportSettings.resolution), frameRate: withSimpleExportDefaults(exportSettings).frameRate })
      .then((result) => { if (active) setHostCheck(result && typeof result === "object" ? result : { ok: true, reasons: [] }); })
      .catch((error) => { if (active) setHostCheck({ ok: false, reasons: [String(error?.message || error)] }); });
    return () => { active = false; };
  }, [hostRender, exportSettings.resolution, exportSettings.frameRate]);
  const hostBlocked = Boolean(hostCheck && hostCheck.ok === false);
  const requestHostRender = () => {
    if (!hostRender || typeof hostBridge?.requestRender !== "function") return;
    onClose();
    const settings = withSimpleExportDefaults(exportSettings);
    hostBridge.requestRender({
      ...(settings.fileName ? { fileName: settings.fileName } : {}),
      resolution: String(settings.resolution),
      frameRate: settings.frameRate,
    });
  };

  return (
    <>
      <div className="export-settings-card export-settings-card-simple">
        <div className="export-settings-heading">
          <div><strong>{t("videoExport")}</strong><small>{t("videoExportHint")}</small></div>
          <span>{format.container}</span>
        </div>

        <label className="export-setting-field">
          <span>{t("exportFileName")}</span>
          {/* FORK: with a host title, the stock default reads as "no name typed"
              and the title shows as the placeholder — the name the export takes. */}
          <input
            maxLength={96}
            value={exportNameFallback && exportSettings.fileName === DEFAULT_EXPORT_SETTINGS.fileName ? "" : exportSettings.fileName || ""}
            placeholder={exportNameFallback || DEFAULT_EXPORT_SETTINGS.fileName}
            onChange={(event) => update({ fileName: event.target.value })}
          />
        </label>

        <div className="export-setting-grid">
          <label className="export-setting-field">
            <span>{t("exportResolution")}</span>
            <select value={exportSettings.resolution} onChange={(event) => update({ resolution: event.target.value })}>
              <option value="720">720p</option>
              <option value="1080">1080p</option>
              <option value="1440">2K</option>
              <option value="2160">4K</option>
            </select>
          </label>
          <label className="export-setting-field">
            <span>{t("exportFrameRate")}</span>
            <select value={String(withSimpleExportDefaults(exportSettings).frameRate)} onChange={(event) => update({ frameRate: Number(event.target.value) })}>
              <option value="24">24 fps</option>
              <option value="30">30 fps</option>
              <option value="60">60 fps</option>
            </select>
          </label>
        </div>

        <div className="export-setting-grid">
          <label className="export-setting-field">
            <span>{t("exportFormat")}</span>
            <select value={exportSettings.codec} onChange={(event) => update({ codec: event.target.value })}>
              <option value="h264">MP4 · H.264</option>
              <option value="h264-mov">MOV · H.264</option>
              <option value="vp9">WebM · VP9</option>
              <option value="vp8">WebM · VP8</option>
            </select>
          </label>
        </div>

        <div className="export-setting-grid">
          <label className="export-setting-field">
            <span>{t("exportVideoBitrate")}</span>
            <select value={selectedVideoBitrate} onChange={(event) => {
              const option = VIDEO_BITRATE_OPTIONS.find(([id]) => id === event.target.value);
              update(option?.[0] === "auto"
                ? { bitrateMode: "auto" }
                : { bitrateMode: "custom", customVideoBitsPerSecond: option?.[1] || 12_000_000 });
            }}>
              {VIDEO_BITRATE_OPTIONS.map(([id]) => (
                <option key={id} value={id}>{id === "auto" ? t("exportBitrateAuto") : `${id} Mbps`}</option>
              ))}
            </select>
          </label>
          <label className="export-setting-field">
            <span>{t("exportAudioBitrate")}</span>
            <select
              value={exportSettings.audioBitsPerSecond || 192_000}
              onChange={(event) => update({ audioBitsPerSecond: Number(event.target.value) })}
            >
              <option value="128000">128 kbps</option>
              <option value="192000">192 kbps</option>
              <option value="256000">256 kbps</option>
              <option value="320000">320 kbps</option>
            </select>
          </label>
        </div>

        <div className="export-technical-summary export-technical-summary-simple">
          <span>{summary.width} × {summary.height}</span>
          <span>{withSimpleExportDefaults(exportSettings).frameRate} fps</span>
          <span>{summary.bitrateMbps} Mbps</span>
          <span>{format.video} + {format.audio}</span>
          <span>≈ {formatEstimatedFileSize(estimate.estimatedBytes)}</span>
          <span>{timelineDuration.toFixed(1)}s</span>
        </div>
        <div className="export-settings-note">
          {t(exportSettings.codec === "h264-mov"
            ? runtimeAvailable ? "exportPipelineDeterministicHint" : "exportRuntimeUnavailable"
            : "exportPipelineAutoHint")}
        </div>
      </div>
      <div className="export-settings-footer">
        <button
          className="export-confirm-button"
          type="button"
          disabled={!imageSrc || checking || !runtimeAvailable || timelineDuration <= 0}
          onClick={() => {
            onClose();
            handleExportVideo({
              settings: withSimpleExportDefaults(exportSettings),
            });
          }}
        >
          <FileArrowDown size={17} weight="bold" />
          {imageSrc ? t("startExport") : t("addVisualBeforeExport")}
        </button>
        {/* FORK: where the browser export lands, when the host keeps it. The
            button above says "export"; inside a host that no longer means the
            download folder, and the person is about to press it. */}
        {hostKeep?.hint ? (
          <div className="export-settings-note is-host-keep" role="note">{hostKeep.hint}</div>
        ) : null}
        {hostRender && hostBlocked ? (
          <div className="export-settings-note is-host-check" role="status">{hostCheck.reasons.join(" · ")}</div>
        ) : null}
        {hostRender ? (
          <button
            className="export-confirm-button is-host"
            type="button"
            title={hostRender.hint || ""}
            disabled={!imageSrc || timelineDuration <= 0 || hostBlocked}
            onClick={requestHostRender}
          >
            <FilmSlate size={17} weight="bold" />
            {hostRender.label}
          </button>
        ) : null}
      </div>
    </>
  );
}
