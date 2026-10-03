import {
  ArrowsHorizontal,
  Check,
  Crop,
  Scan,
  SpinnerGap,
  Trash,
  X,
} from "@phosphor-icons/react";

import { RATIO_OPTIONS } from "../config/editor.js";

const MOTIONS = [
  ["locked", "稳镜", "尽量不移动"],
  ["smooth", "平滑", "自然跟随主体"],
  ["responsive", "灵敏", "快速响应运动"],
];

export function SmartFramePanel({ t, smartFrame }) {
  const segment = smartFrame?.segment;
  const job = smartFrame?.job || {};
  const stats = smartFrame?.draft?.stats || smartFrame?.applied?.stats || null;
  const presentation = smartFrame?.draft?.presentation || smartFrame?.applied?.presentation || "crop";
  const canAnalyze = Boolean(segment && ["image", "video"].includes(segment.type));
  return (
    <div className="smart-frame-panel">
      <section className="smart-frame-intro">
        <span className="smart-frame-intro-icon"><Crop size={22} weight="duotone" /></span>
        <div>
          <strong>{t("smartFrameCurrentClip", "当前片段智能改画幅")}</strong>
          <p>{t("smartFrameCurrentClipHint", "稀疏检测主体，使用光流跟踪运动，并生成平滑的裁切路径。")}</p>
          <small className="smart-frame-acceleration">{t("smartFrameGpuPreferred", "WebGPU 检测优先 · 自动兼容 WASM")}</small>
        </div>
      </section>

      {!canAnalyze ? (
        <div className="smart-frame-empty">
          <Scan size={26} weight="duotone" />
          <strong>{t("smartFrameSelectClip", "先选择一个图片或视频片段")}</strong>
          <span>{t("smartFrameSelectClipHint", "Smart Frame 只会修改当前选中的 Visuals 片段。")}</span>
        </div>
      ) : (
        <>
          <div className="smart-frame-section-heading">
            <strong>{t("smartFrameTargetRatio", "目标画幅")}</strong>
            <span>{t("smartFrameCurrentClip", "当前片段")}</span>
          </div>
          <div className="smart-frame-ratios" role="radiogroup" aria-label={t("smartFrameTargetRatio", "目标画幅")}>
            {RATIO_OPTIONS.map((option) => (
              <button
                className={smartFrame.targetRatioId === option.id ? "is-active" : ""}
                type="button"
                role="radio"
                aria-checked={smartFrame.targetRatioId === option.id}
                key={option.id}
                disabled={job.running}
                onClick={() => smartFrame.setTargetRatioId(option.id)}
              >
                <i style={{ aspectRatio: `${option.width}/${option.height}` }} />
                <strong>{option.label}</strong>
              </button>
            ))}
          </div>

          <div className="smart-frame-section-heading">
            <strong>{t("smartFrameMotion", "镜头跟随")}</strong>
            <span>{t("smartFrameMotionHint", "只重新求解路径，不重复下载模型")}</span>
          </div>
          <div className="smart-frame-motion-options">
            {MOTIONS.map(([id, label, hint]) => (
              <button
                className={smartFrame.settings.motion === id ? "is-active" : ""}
                type="button"
                key={id}
                disabled={job.running}
                onClick={() => smartFrame.setSettings({ motion: id })}
              >
                <strong>{t(`smartFrameMotion_${id}`, label)}</strong>
                <span>{t(`smartFrameMotionHint_${id}`, hint)}</span>
              </button>
            ))}
          </div>

          <label className="smart-frame-padding">
            <span><strong>{t("smartFramePadding", "主体留白")}</strong><em>{Math.round(smartFrame.settings.padding * 100)}%</em></span>
            <input
              type="range"
              min="0.06"
              max="0.32"
              step="0.01"
              value={smartFrame.settings.padding}
              disabled={job.running}
              onChange={(event) => smartFrame.setSettings({ padding: Number(event.target.value) })}
            />
          </label>

          <button className="panel-primary smart-frame-analyze" type="button" onClick={smartFrame.analyze}>
            {job.running ? <SpinnerGap className="is-spinning" size={18} /> : <Scan size={18} weight="bold" />}
            {job.running
              ? t("smartFrameCancelAnalysis", "取消分析")
              : smartFrame.draft
                ? t("smartFrameAnalyzeAgain", "重新分析当前片段")
                : t("smartFrameAnalyzeClip", "分析并生成构图预览")}
          </button>

          {job.stage !== "idle" ? (
            <div className={`smart-frame-progress is-${job.stage}`} role="status" aria-live="polite">
              <div>
                <span>{job.stage === "setup" ? t("smartFrameModelSetup", "模型准备") : t("smartFrameClipAnalysis", "片段分析")}</span>
                <strong>{Math.round(job.progress || 0)}%</strong>
              </div>
              <i><b style={{ width: `${Math.max(0, Math.min(100, job.progress || 0))}%` }} /></i>
              <p>{job.phase}</p>
            </div>
          ) : null}

          {smartFrame.draft || smartFrame.applied ? (
            <>
              <div className="smart-frame-compare" role="group" aria-label={t("smartFrameCompare", "前后预览")}>
                <button type="button" className={smartFrame.compareMode === "original" ? "is-active" : ""} onClick={() => smartFrame.setCompareMode("original")}>
                  {t("smartFrameBefore", "原始画面")}
                </button>
                <button type="button" className={smartFrame.compareMode === "after" ? "is-active" : ""} onClick={() => smartFrame.setCompareMode("after")}>
                  {t("smartFrameAfter", "构图结果")}
                </button>
              </div>
              {stats ? (
                <>
                  <div className="smart-frame-stats">
                    <span><strong>{stats.anchorCount || 0}</strong>{t("smartFrameAnchors", "检测锚点")}</span>
                    <span><strong>{stats.flowCount || 0}</strong>{t("smartFrameFlowFrames", "光流帧")}</span>
                    <span><strong>{smartFrame.draft?.cropKeyframes?.length || smartFrame.applied?.cropKeyframes?.length || 0}</strong>{t("smartFramePathPoints", "路径关键帧")}</span>
                  </div>
                  <p className={`smart-frame-runtime is-${stats.runtimeBackend || "unknown"}`}>
                    {stats.runtimeBackend === "webgpu"
                      ? `${t("smartFrameWebGpuRuntime", "WebGPU 主体检测 · WASM 光流")}${stats.analysisMs ? ` · ${(stats.analysisMs / 1000).toFixed(1)}s` : ""}`
                      : stats.runtimeBackend === "wasm"
                        ? `${t("smartFrameWasmRuntime", "WASM 兼容模式")}${stats.analysisMs ? ` · ${(stats.analysisMs / 1000).toFixed(1)}s` : ""}`
                        : t("smartFrameLegacyRuntime", "旧分析结果 · 重新分析后启用 WebGPU")}
                  </p>
                </>
              ) : null}
              {presentation === "safe-contain" ? (
                <p className="smart-frame-safe-contain">
                  {t("smartFrameSafeContain", "当前比例无法仅靠裁切完整保留头部，已切换为智能舞台构图；其他比例仍独立使用主体跟随裁切。")}
                </p>
              ) : null}
              <div className="smart-frame-actions">
                <button type="button" className="panel-secondary" onClick={smartFrame.cancel} disabled={job.running}>
                  <X size={16} />{t("cancel", "取消")}
                </button>
                <button type="button" className="panel-primary" onClick={smartFrame.apply} disabled={job.running || !smartFrame.dirty}>
                  <Check size={16} weight="bold" />{t("apply", "应用")}
                </button>
              </div>
              {smartFrame.applied && !smartFrame.dirty ? (
                <button className="smart-frame-remove" type="button" onClick={smartFrame.remove}>
                  <Trash size={15} />{t("smartFrameRemove", "移除当前片段的 Smart Frame")}
                </button>
              ) : null}
            </>
          ) : null}
        </>
      )}
      <p className="smart-frame-local-note">
        <ArrowsHorizontal size={15} />
        {t("smartFrameLocalNote", "媒体留在浏览器本地；预览、工程恢复和导出使用同一条裁切路径。")}
      </p>
    </div>
  );
}
