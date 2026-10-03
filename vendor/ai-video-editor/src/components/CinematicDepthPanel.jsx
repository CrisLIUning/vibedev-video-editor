import { Aperture, CheckCircle, CircleNotch, Eye, EyeSlash, X } from "@phosphor-icons/react";

import { normalizeCinematicDepth } from "../lib/depthOfField.js";

function DepthRange({ label, value, min, max, step, display, low, high, onChange }) {
  return (
    <label className="cinematic-depth-range">
      <span><strong>{label}</strong><output>{display(value)}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <small><span>{low}</span><span>{high}</span></small>
    </label>
  );
}

export function CinematicDepthPanel({ t, segment, analysis, job, onAnalyze, onCancel, onChange }) {
  const effect = normalizeCinematicDepth(segment?.cinematicDepth);
  const preview = analysis?.samples?.[Math.max(0, analysis.samples.length - 1)] || null;
  const running = Boolean(job?.running);
  const analyzed = analysis?.complete === true;
  const update = (patch) => onChange?.({ ...effect, ...patch });

  return (
    <div className="cinematic-depth-panel">
      <div className="cinematic-depth-hero">
        <span><Aperture size={22} weight="duotone" /></span>
        <div>
          <small>{t("depthKicker")}</small>
          <strong>{t("depthTitle")}</strong>
          <em>{t("depthDescription")}</em>
        </div>
      </div>

      <section className={`cinematic-depth-analysis ${analyzed ? "is-ready" : ""}`}>
        <div className="cinematic-depth-map">
          {preview?.depthUrl ? <img src={preview.depthUrl} alt={t("depthMapAlt")} /> : <Aperture size={30} weight="duotone" />}
          {preview?.depthUrl ? <i style={{ left: `${effect.focus * 100}%` }} /> : null}
        </div>
        <div className="cinematic-depth-analysis-copy">
          <span>{analyzed ? <CheckCircle size={17} weight="fill" /> : <CircleNotch size={17} className={running ? "is-spinning" : ""} />}</span>
          <div>
            <strong>{analyzed ? t("depthAnalysisComplete") : running ? job.phase : t("depthAnalysisNeeded")}</strong>
            <em>{analyzed
              ? `${analysis.samples?.length || 1} ${t("depthFramesUnit")} · ${analysis.fps || 1} fps`
              : t("depthAnalysisHint")}</em>
          </div>
        </div>
      </section>

      {job?.stage !== "idle" && (running || job?.error) ? (
        <div className={`cinematic-depth-progress ${job.error ? "is-error" : ""}`} aria-live="polite">
          <div><span>{job.stage === "setup" ? t("depthModelSetup") : t("depthAnalyzing")}</span><strong>{Math.round(job.progress || 0)}%</strong></div>
          <i><b style={{ width: `${Math.round(job.progress || 0)}%` }} /></i>
          <small>{job.error || job.phase}</small>
        </div>
      ) : null}

      <div className="cinematic-depth-actions">
        {running ? <button className="panel-secondary" type="button" onClick={onCancel}><X size={15} />{t("cancel")}</button> : null}
        <button className="panel-primary" type="button" disabled={!segment || running} onClick={onAnalyze}>
          <Aperture size={16} weight="duotone" />
          {analyzed ? t("depthReanalyze") : t("depthAnalyze")}
        </button>
      </div>

      <section className="cinematic-depth-controls">
        <label className="cinematic-depth-toggle">
          <span>{effect.enabled ? <Eye size={17} /> : <EyeSlash size={17} />}</span>
          <span><strong>{t("depthEnable")}</strong><em>{t("depthEnableHint")}</em></span>
          <input type="checkbox" checked={effect.enabled} disabled={!analyzed} onChange={(event) => update({ enabled: event.target.checked })} />
        </label>

        <DepthRange
          label={t("depthFocusDistance")}
          value={effect.focus}
          min={0}
          max={1}
          step={0.01}
          display={(value) => `${Math.round(value * 100)}%`}
          low={t("depthFar")}
          high={t("depthNear")}
          onChange={(focus) => update({ focus })}
        />
        <DepthRange
          label={t("depthFocusRange")}
          value={effect.focusRange}
          min={0.04}
          max={0.48}
          step={0.01}
          display={(value) => `${Math.round(value * 100)}%`}
          low={t("depthNarrow")}
          high={t("depthWide")}
          onChange={(focusRange) => update({ focusRange })}
        />
        <DepthRange
          label={t("depthBlurStrength")}
          value={effect.blur}
          min={0}
          max={40}
          step={1}
          display={(value) => `${Math.round(value)} px`}
          low={t("depthSoft")}
          high={t("depthStrong")}
          onChange={(blur) => update({ blur })}
        />
        <DepthRange
          label={t("depthHighlightBoost")}
          value={effect.highlightBoost}
          min={0}
          max={0.7}
          step={0.01}
          display={(value) => `${Math.round(value * 100)}%`}
          low={t("depthNatural")}
          high={t("depthBokeh")}
          onChange={(highlightBoost) => update({ highlightBoost })}
        />

        <div className="cinematic-depth-quality">
          <span><strong>{t("depthAnalysisQuality")}</strong><em>{t("depthQualityHint")}</em></span>
          <div>
            {["fast", "balanced", "quality"].map((quality) => (
              <button className={effect.quality === quality ? "is-active" : ""} type="button" key={quality} disabled={running} onClick={() => update({ quality })}>
                {t(`depthQuality_${quality}`)}
              </button>
            ))}
          </div>
        </div>
      </section>

      <p className="cinematic-depth-note">{t("depthLocalNote")}</p>
    </div>
  );
}

