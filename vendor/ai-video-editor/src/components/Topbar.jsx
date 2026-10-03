import { useEffect, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  CaretDown,
  CircleNotch,
  Database,
  FileArrowDown,
  FileArrowUp,
  FilePlus,
  GearSix,
  Pause,
  Play,
  ShieldCheck,
  SlidersHorizontal, FilmStrip, TextAlignLeft, Stack } from "@phosphor-icons/react";

import { RATIO_OPTIONS } from "../config/editor.js";
import { APP_LANGUAGES, saveLanguagePreference } from "../i18n.js";
import { getPrimaryShortcutModifier, releasePointerActivatedFocus } from "../lib/editorShortcuts.js";
import { formatStorageBytes, inspectModelCache } from "../lib/modelCacheInspection.js";
import { ExportSettingsPanel } from "./ExportSettingsPanel.jsx";
import { IconButton, Popover } from "./ui.jsx";

export function Topbar({
  t,
  // FORK: the host's actions ride into the export panel; null when standalone.
  hostBridge = null,
  projectName,
  // FORK: what an export is called until someone types a name (the host's project title).
  exportNameFallback = "",
  compactRail,
  setCompactRail,
  lastSaved,
  undo,
  redo,
  ratio,
  ratioId,
  showRatioMenu,
  setShowRatioMenu,
  setRatioId,
  notify,
  isPlaying,
  handlePlayToggle,
  imageSrc,
  exporting,
  handleExportVideo,
  showExportMenu,
  setShowExportMenu,
  exportSettings,
  setExportSettings,
  timelineDuration,
  showSettings,
  setShowSettings,
  activeLanguage,
  setUiLanguage,
  captionsEnabled,
  setCaptionsEnabled,
  trackVisibility,
  toggleTrackVisibility,
  showFileMenu,
  setShowFileMenu,
  handleNewProject,
  handleExportProject,
  handleImportProject,
  projectFileInputRef,
}) {
  const projectAnchorRef = useRef(null);
  // FORK: the host's shot lists — the desk's sequence videos on the board —
  // shown in the file menu while it is open. Placing goes through the host.
  const hostShots = hostBridge?.hostActions?.shotSequences || null;
  const [hostSequences, setHostSequences] = useState(null);
  const [hostPlacing, setHostPlacing] = useState("");
  useEffect(() => {
    if (!showFileMenu || !hostShots) { setHostSequences(null); return undefined; }
    let active = true;
    hostShots.list()
      .then((items) => { if (active) setHostSequences(Array.isArray(items) ? items : []); })
      .catch(() => { if (active) setHostSequences([]); });
    return () => { active = false; };
  }, [showFileMenu, hostShots]);
  const placeHostSequence = async (sequenceId, mode) => {
    if (!hostShots || hostPlacing) return;
    setHostPlacing(sequenceId);
    try {
      await hostShots.place(sequenceId, mode);
      setShowFileMenu(false);
    } catch {
      // The host reports through its own notice; the menu stays open.
    } finally {
      setHostPlacing("");
    }
  };
  // FORK: the host's scripts — text nodes on the board — shown in the file
  // menu while it is open: captions per shot, or captions and a voice for each.
  const hostScripts = hostBridge?.hostActions?.scripts || null;
  const [hostScriptList, setHostScriptList] = useState(null);
  const [hostScripting, setHostScripting] = useState("");
  useEffect(() => {
    if (!showFileMenu || !hostScripts) { setHostScriptList(null); return undefined; }
    let active = true;
    hostScripts.list()
      .then((items) => { if (active) setHostScriptList(Array.isArray(items) ? items : []); })
      .catch(() => { if (active) setHostScriptList([]); });
    return () => { active = false; };
  }, [showFileMenu, hostScripts]);
  const placeHostScript = async (scriptId, mode) => {
    if (!hostScripts || hostScripting) return;
    setHostScripting(scriptId);
    try {
      await hostScripts.place(scriptId, mode);
      setShowFileMenu(false);
    } catch {
      // The host reports through its own notice; the menu stays open.
    } finally {
      setHostScripting("");
    }
  };
  // FORK: the host's board material — the media nodes on the board — shown in
  // the file menu while it is open. Placing goes through the host, which knows
  // where the playhead is.
  const hostMedia = hostBridge?.hostActions?.boardMedia || null;
  const [hostMediaList, setHostMediaList] = useState(null);
  const [hostPlacingMedia, setHostPlacingMedia] = useState("");
  useEffect(() => {
    if (!showFileMenu || !hostMedia) { setHostMediaList(null); return undefined; }
    let active = true;
    hostMedia.list()
      .then((items) => { if (active) setHostMediaList(Array.isArray(items) ? items : []); })
      .catch(() => { if (active) setHostMediaList([]); });
    return () => { active = false; };
  }, [showFileMenu, hostMedia]);
  const placeHostMedia = async (nodeId, track) => {
    if (!hostMedia || hostPlacingMedia) return;
    setHostPlacingMedia(nodeId);
    try {
      await hostMedia.place(nodeId, track);
      setShowFileMenu(false);
    } catch {
      // The host reports through its own notice; the menu stays open.
    } finally {
      setHostPlacingMedia("");
    }
  };
  // FORK: the takes that could fill the selected clip. Which clip that is
  // comes from the editor's own selection through the host, so this menu asks
  // for a list rather than saying which slot it means.
  const hostVersions = hostBridge?.hostActions?.versions || null;
  const [hostVersionList, setHostVersionList] = useState(null);
  const [hostSwapping, setHostSwapping] = useState("");
  useEffect(() => {
    if (!showFileMenu || !hostVersions) { setHostVersionList(null); return undefined; }
    let active = true;
    hostVersions.list()
      .then((answer) => { if (active) setHostVersionList(answer && Array.isArray(answer.versions) ? answer : { slot: null, versions: [] }); })
      .catch(() => { if (active) setHostVersionList({ slot: null, versions: [] }); });
    return () => { active = false; };
  }, [showFileMenu, hostVersions]);
  const useHostVersion = async (versionId) => {
    if (!hostVersions || hostSwapping) return;
    setHostSwapping(versionId);
    try {
      await hostVersions.use(versionId);
      setShowFileMenu(false);
    } catch {
      // The host reports through its own notice; the menu stays open.
    } finally {
      setHostSwapping("");
    }
  };
  const ratioAnchorRef = useRef(null);
  const exportAnchorRef = useRef(null);
  const settingsAnchorRef = useRef(null);
  const modelCacheControlRef = useRef(null);
  const [modelCacheInspection, setModelCacheInspection] = useState({ state: "idle", result: null });
  const shortcutModifier = getPrimaryShortcutModifier();
  const shortcutRows = [
    ["shortcutPlayPause", "Space"],
    ["shortcutSplit", `${shortcutModifier}+B`],
    ["shortcutDuplicate", `${shortcutModifier}+D`],
    ["shortcutDelete", "Delete / Backspace"],
    ["shortcutUndo", `${shortcutModifier}+Z`],
    ["shortcutRedo", `${shortcutModifier}+Shift+Z`],
    ["shortcutZoomOut", "−"],
    ["shortcutZoomIn", "+"],
    ["shortcutFitTimeline", "Shift+Z"],
    ["shortcutSelectLeft", "["],
    ["shortcutSelectRight", "]"],
  ];
  const checkModelCache = async () => {
    setModelCacheInspection({ state: "checking", result: null });
    try {
      const result = await inspectModelCache();
      setModelCacheInspection({ state: "ready", result });
    } catch {
      setModelCacheInspection({ state: "unavailable", result: null });
    }
  };
  const modelCacheResult = modelCacheInspection.result;
  const modelCacheSummary = modelCacheResult?.entryCount > 0
    ? t("modelCacheFound")
      .replace("{groups}", String(modelCacheResult.cacheCount))
      .replace("{files}", String(modelCacheResult.entryCount))
    : t("modelCacheEmpty");
  const modelCacheStorage = modelCacheResult?.usage != null
    ? t("modelCacheStorage")
      .replace("{usage}", formatStorageBytes(modelCacheResult.usage))
      .replace("{quota}", modelCacheResult.quota ? formatStorageBytes(modelCacheResult.quota) : "—")
    : "";
  useEffect(() => {
    if (!showSettings || modelCacheInspection.state === "idle") return undefined;
    const frame = window.requestAnimationFrame(() => {
      modelCacheControlRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [modelCacheInspection.state, showSettings]);

  return (
    <header className="topbar">
      <div className="project-cluster">
        <IconButton label={t("collapseSidebar")} active={compactRail} onClick={() => setCompactRail((v) => !v)}>
          <SlidersHorizontal size={19} />
        </IconButton>
        <div>
          <div className="project-title-row">
            <div className="project-title" title={projectName}>{projectName}</div>
            <div className="menu-anchor" ref={projectAnchorRef}>
              <button className="project-file-button" type="button" onClick={() => setShowFileMenu((open) => !open)}>
                {t("fileMenu")} <CaretDown size={13} />
              </button>
              {showFileMenu ? (
                <Popover anchorRef={projectAnchorRef} className="project-file-popover" closeLabel={t("close")} onClose={() => setShowFileMenu(false)}>
                  <div className="file-menu-card">
                    <div className="file-menu-heading">
                      <span>{t("projectMenuHeading")}</span>
                      <small>VibeDev</small>
                    </div>
                    <button className="file-menu-action file-menu-new" type="button" onClick={handleNewProject}>
                      <span className="file-menu-icon"><FilePlus size={17} /></span>
                      <span className="file-menu-copy"><strong>{t("newProject")}</strong><small>{t("newProjectHint")}</small></span>
                    </button>
                    <div className="file-menu-divider" />
                    <button className="file-menu-action" type="button" onClick={() => handleImportProject()}>
                      <span className="file-menu-icon"><FileArrowUp size={17} /></span>
                      <span className="file-menu-copy"><strong>{t("importProject")}</strong><small>{t("importProjectHint")}</small></span>
                      <span className="file-menu-format">.timeline</span>
                    </button>
                    <button className="file-menu-action is-primary" type="button" onClick={handleExportProject}>
                      <span className="file-menu-icon"><FileArrowDown size={17} /></span>
                      <span className="file-menu-copy"><strong>{t("exportProject")}</strong><small>{t("exportProjectHint")}</small></span>
                      <span className="file-menu-format">.timeline</span>
                    </button>
                    {hostShots ? (
                      <>
                        <div className="file-menu-divider" />
                        <div className="file-menu-heading file-menu-host-heading">
                          <span>{hostShots.label}</span>
                          {hostShots.hint ? <small>{hostShots.hint}</small> : null}
                        </div>
                        {hostSequences === null ? null : hostSequences.length === 0 ? (
                          <div className="file-menu-host-empty">{hostShots.labels.empty}</div>
                        ) : hostSequences.map((sequence) => (
                          <div className="file-menu-action file-menu-host-sequence" key={sequence.id}>
                            <span className="file-menu-icon"><FilmStrip size={17} /></span>
                            <span className="file-menu-copy">
                              <strong>{sequence.title}</strong>
                              <small>{Number(sequence.durationSeconds).toFixed(1)}s · {sequence.shotCount} {hostShots.labels.shots}</small>
                            </span>
                            <span className="file-menu-host-buttons">
                              <button type="button" disabled={Boolean(hostPlacing)} onClick={() => placeHostSequence(sequence.id, "append")}>{hostShots.labels.append}</button>
                              <button type="button" disabled={Boolean(hostPlacing)} onClick={() => placeHostSequence(sequence.id, "replace")}>{hostShots.labels.replace}</button>
                            </span>
                          </div>
                        ))}
                      </>
                    ) : null}
                    {hostMedia ? (
                      <>
                        <div className="file-menu-divider" />
                        <div className="file-menu-heading file-menu-host-heading">
                          <span>{hostMedia.label}</span>
                          {hostMedia.hint ? <small>{hostMedia.hint}</small> : null}
                        </div>
                        {hostMediaList === null ? null : hostMediaList.length === 0 ? (
                          <div className="file-menu-host-empty">{hostMedia.labels.empty}</div>
                        ) : hostMediaList.map((item) => (
                          <div className="file-menu-action file-menu-host-sequence" key={item.id}>
                            <span className="file-menu-icon"><Stack size={17} /></span>
                            <span className="file-menu-copy">
                              <strong>{item.title}</strong>
                              <small>{item.kind}{Number.isFinite(item.durationSeconds) ? ` · ${Number(item.durationSeconds).toFixed(1)}s` : ""}</small>
                            </span>
                            <span className="file-menu-host-buttons">
                              <button type="button" disabled={Boolean(hostPlacingMedia)} onClick={() => placeHostMedia(item.id, "default")}>{hostMedia.labels.place}</button>
                              {item.kind === "audio" ? (
                                <button type="button" disabled={Boolean(hostPlacingMedia)} onClick={() => placeHostMedia(item.id, "music")}>{hostMedia.labels.music}</button>
                              ) : null}
                            </span>
                          </div>
                        ))}
                      </>
                    ) : null}
                    {hostVersions ? (
                      <>
                        <div className="file-menu-divider" />
                        <div className="file-menu-heading file-menu-host-heading">
                          <span>{hostVersions.label}</span>
                          {hostVersionList?.slot
                            ? <small>{hostVersionList.slot.title} · {Number(hostVersionList.slot.durationSeconds).toFixed(1)}s</small>
                            : hostVersions.hint ? <small>{hostVersions.hint}</small> : null}
                        </div>
                        {hostVersionList === null ? null : !hostVersionList.slot ? (
                          <div className="file-menu-host-empty">{hostVersions.labels.none}</div>
                        ) : hostVersionList.versions.length <= 1 ? (
                          <div className="file-menu-host-empty">{hostVersions.labels.empty}</div>
                        ) : hostVersionList.versions.map((item) => (
                          <div className="file-menu-action file-menu-host-sequence" key={item.id}>
                            <span className="file-menu-icon"><Stack size={17} /></span>
                            <span className="file-menu-copy">
                              <strong>{item.title}</strong>
                              <small>{item.refusal || `${item.kind}${Number.isFinite(item.durationSeconds) ? ` \u00b7 ${Number(item.durationSeconds).toFixed(1)}s` : ""}`}</small>
                            </span>
                            <span className="file-menu-host-buttons">
                              {item.current
                                ? <span className="file-menu-host-current">{hostVersions.labels.current}</span>
                                : <button type="button" disabled={Boolean(hostSwapping) || Boolean(item.refusal)} onClick={() => useHostVersion(item.id)}>{hostVersions.labels.use}</button>}
                            </span>
                          </div>
                        ))}
                      </>
                    ) : null}
                    {hostScripts ? (
                      <>
                        <div className="file-menu-divider" />
                        <div className="file-menu-heading file-menu-host-heading">
                          <span>{hostScripts.label}</span>
                          {hostScripts.hint ? <small>{hostScripts.hint}</small> : null}
                        </div>
                        {hostScriptList === null ? null : hostScriptList.length === 0 ? (
                          <div className="file-menu-host-empty">{hostScripts.labels.empty}</div>
                        ) : hostScriptList.map((item) => (
                          <div className="file-menu-action file-menu-host-sequence" key={item.id}>
                            <span className="file-menu-icon"><TextAlignLeft size={17} /></span>
                            <span className="file-menu-copy">
                              <strong>{item.title}</strong>
                              <small>{item.lineCount} {hostScripts.labels.lines} · {item.preview}</small>
                            </span>
                            <span className="file-menu-host-buttons">
                              <button type="button" disabled={Boolean(hostScripting)} onClick={() => placeHostScript(item.id, "captions")}>{hostScripts.labels.captions}</button>
                              <button type="button" disabled={Boolean(hostScripting)} onClick={() => placeHostScript(item.id, "voice")}>{hostScripts.labels.voice}</button>
                            </span>
                          </div>
                        ))}
                      </>
                    ) : null}
                  </div>
                </Popover>
              ) : null}
              <input ref={projectFileInputRef} className="project-file-input" type="file" accept="application/zip,.timeline" onChange={(event) => event.target.files?.[0] && handleImportProject(event.target.files[0])} />
            </div>
          </div>
          <div className="autosave">
            <ShieldCheck size={13} weight="fill" />
            {t("autosave")} · {lastSaved}
          </div>
        </div>
      </div>

      <div className="topbar-center">
        <button className="ghost-action" type="button" title={`${t("undo")} · ${shortcutModifier}+Z`} onClick={(event) => { undo(); releasePointerActivatedFocus(event); }}>
          <ArrowCounterClockwise size={16} />
          {t("undo")}
        </button>
        <button className="ghost-action" type="button" title={`${t("redo")} · ${shortcutModifier}+Shift+Z`} onClick={(event) => { redo(); releasePointerActivatedFocus(event); }}>
          <ArrowClockwise size={16} />
          {t("redo")}
        </button>
        <span className="divider" />
        <div className="menu-anchor" ref={ratioAnchorRef}>
          <button
            className="ratio-select"
            type="button"
            onClick={() => setShowRatioMenu((open) => !open)}
          >
            {ratio.label} <CaretDown size={14} />
          </button>
          {showRatioMenu ? (
            <Popover anchorRef={ratioAnchorRef} closeLabel={t("close")} onClose={() => setShowRatioMenu(false)}>
              <div className="menu-list">
                {RATIO_OPTIONS.map((option) => (
                  <button
                    type="button"
                    className={option.id === ratioId ? "is-selected" : ""}
                    key={option.id}
                    onClick={() => {
                      setRatioId(option.id);
                      setShowRatioMenu(false);
                      notify(`画布比例已切换为 ${option.label}`);
                    }}
                  >
                    {option.label}
                    <span>
                      {option.width} x {option.height}
                    </span>
                  </button>
                ))}
              </div>
            </Popover>
          ) : null}
        </div>
      </div>

      <div className="topbar-actions">
        <button className="preview-button" type="button" title={`${t("shortcutPlayPause")} · Space`} onClick={(event) => { handlePlayToggle(); releasePointerActivatedFocus(event); }}>
          {isPlaying ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}
          {t("preview")}
        </button>
        <div className="menu-anchor" ref={exportAnchorRef}>
          <button
            className="export-button"
            type="button"
            aria-expanded={showExportMenu}
            disabled={exporting}
            onClick={() => setShowExportMenu((open) => !open)}
          >
            <FileArrowDown size={17} weight="bold" />
            {exporting ? t("exporting") : t("exportVideo")}
            {!exporting ? <CaretDown size={13} weight="bold" /> : null}
          </button>
          {showExportMenu ? (
            <Popover anchorRef={exportAnchorRef} className="export-settings-popover" closeLabel={t("close")} onClose={() => setShowExportMenu(false)}>
              <ExportSettingsPanel
                t={t}
                hostBridge={hostBridge}
                ratio={ratio}
                imageSrc={imageSrc}
                timelineDuration={timelineDuration}
                exportSettings={exportSettings}
                setExportSettings={setExportSettings}
                handleExportVideo={handleExportVideo}
                exportNameFallback={exportNameFallback}
                onClose={() => setShowExportMenu(false)}
              />
            </Popover>
          ) : null}
        </div>
        <div className="menu-anchor" ref={settingsAnchorRef}>
          <IconButton label={t("settings")} active={showSettings} onClick={() => setShowSettings((open) => !open)}>
            <GearSix size={19} />
          </IconButton>
          {showSettings ? (
            <Popover anchorRef={settingsAnchorRef} closeLabel={t("close")} onClose={() => setShowSettings(false)}>
              <div className="settings-panel">
                <strong>{t("exportSettings")}</strong>
                <label>
                  <span>{t("language")}</span>
                  <select
                    value={activeLanguage}
                    onChange={(event) => {
                      const nextLanguage = event.target.value;
                      saveLanguagePreference(nextLanguage);
                      setUiLanguage(nextLanguage);
                    }}
                  >
                    {APP_LANGUAGES.map((language) => (
                      <option value={language.id} key={language.id}>
                        {language.nativeName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={captionsEnabled}
                    onChange={(event) => setCaptionsEnabled(event.target.checked)}
                  />
                  {t("exportCaptions")}
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={trackVisibility.audio}
                    onChange={() => toggleTrackVisibility("audio")}
                  />
                  {t("enableAudioTrack")}
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={trackVisibility.source}
                    onChange={() => toggleTrackVisibility("source")}
                  />
                  {t("enableSourceTrack")}
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={trackVisibility.music}
                    onChange={() => toggleTrackVisibility("music")}
                  />
                  {t("enableMusicTrack")}
                </label>
                <section className="shortcut-guide" aria-labelledby="shortcut-guide-title">
                  <div className="shortcut-guide-heading">
                    <strong id="shortcut-guide-title">{t("keyboardShortcuts")}</strong>
                    <span>VibeDev</span>
                  </div>
                  <p>{t("keyboardShortcutsHint")}</p>
                  <dl>
                    {shortcutRows.map(([labelKey, shortcut]) => (
                      <div key={labelKey}>
                        <dt>{t(labelKey)}</dt>
                        <dd><kbd>{shortcut}</kbd></dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <div ref={modelCacheControlRef} className="model-cache-control">
                  {modelCacheInspection.state !== "idle" ? (
                    <div className={`model-cache-result is-${modelCacheInspection.state}`} role="status" aria-live="polite">
                      <strong>{modelCacheInspection.state === "checking"
                        ? t("modelCacheChecking")
                        : modelCacheInspection.state === "unavailable"
                          ? t("modelCacheUnavailable")
                          : modelCacheSummary}</strong>
                      {modelCacheInspection.state === "ready" && modelCacheStorage ? <span>{modelCacheStorage}</span> : null}
                    </div>
                  ) : null}
                  <button type="button" disabled={modelCacheInspection.state === "checking"} onClick={checkModelCache}>
                    <span>{modelCacheInspection.state === "checking" ? t("modelCacheChecking") : t("checkModelCache")}</span>
                    {modelCacheInspection.state === "checking" ? <CircleNotch className="is-spinning" size={15} /> : <Database size={15} />}
                  </button>
                </div>
              </div>
            </Popover>
          ) : null}
        </div>
      </div>
    </header>
  );
}
