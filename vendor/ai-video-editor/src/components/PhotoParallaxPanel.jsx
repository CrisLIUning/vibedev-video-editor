import { CheckCircle, CircleNotch, Eye, EyeSlash, Stack, X } from "@phosphor-icons/react";

import { normalizePhotoParallax } from "../lib/photoParallax.js";

function ParallaxRange({ label, value, min, max, step, display, low, high, onChange }) {
  return (
    <label className="cinematic-depth-range">
      <span><strong>{label}</strong><output>{display(value)}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <small><span>{low}</span><span>{high}</span></small>
    </label>
  );
}

export function PhotoParallaxPanel({ t, segment, analysis, job, onAnalyze, onCancel, onChange }) {
  const effect = normalizePhotoParallax(segment?.photoParallax);
  const preview = analysis?.samples?.[Math.max(0, analysis.samples.length - 1)] || null;
  const running = Boolean(job?.running);
  const analyzed = analysis?.complete === true;
  const imageOnly = segment?.type === "image";
  const update = (patch) => onChange?.({ ...effect, ...patch });

  return (
    <div className="cinematic-depth-panel photo-parallax-panel">
      <div className="cinematic-depth-hero photo-parallax-hero">
        <span><Stack size={22} weight="duotone" /></span>
        <div>
          <small>{t("parallaxKicker")}</small>
          <strong>{t("parallaxTitle")}</strong>
          <em>{t("parallaxDescription")}</em>
        </div>
      </div>

      {!imageOnly ? (
        <div className="photo-parallax-image-only">
          <Stack size={23} weight="duotone" />
          <span><strong>{t("parallaxImageOnly")}</strong><em>{t("parallaxImageOnlyHint")}</em></span>
        </div>
      ) : null}

      <section className={`cinematic-depth-analysis ${analyzed ? "is-ready" : ""}`}>
        <div className="cinematic-depth-map photo-parallax-map">
          {preview?.depthUrl ? <img src={preview.depthUrl} alt={t("depthMapAlt")} /> : <Stack size={30} weight="duotone" />}
          {preview?.depthUrl ? <><i className="is-background" style={{ left: `${effect.backgroundDepth * 100}%` }} /><i className="is-foreground" style={{ left: `${effect.foregroundDepth * 100}%` }} /></> : null}
        </div>
        <div className="cinematic-depth-analysis-copy">
          <span>{analyzed ? <CheckCircle size={17} weight="fill" /> : <CircleNotch size={17} className={running ? "is-spinning" : ""} />}</span>
          <div>
            <strong>{analyzed ? t("parallaxLayersReady") : running ? job.phase : t("depthAnalysisNeeded")}</strong>
            <em>{analyzed ? t("parallaxLayersSummary") : t("parallaxAnalysisHint")}</em>
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
        <button className="panel-primary" type="button" disabled={!imageOnly || running} onClick={onAnalyze}>
          <Stack size={16} weight="duotone" />
          {analyzed ? t("depthReanalyze") : t("parallaxAnalyze")}
        </button>
      </div>

      <section className="cinematic-depth-controls">
        <label className="cinematic-depth-toggle">
          <span>{effect.enabled ? <Eye size={17} /> : <EyeSlash size={17} />}</span>
          <span><strong>{t("parallaxEnable")}</strong><em>{t("parallaxEnableHint")}</em></span>
          <input type="checkbox" checked={effect.enabled} disabled={!imageOnly || !analyzed} onChange={(event) => update({ enabled: event.target.checked })} />
        </label>

        <div className="cinematic-depth-quality photo-parallax-direction">
          <span><strong>{t("parallaxDirection")}</strong><em>{t("parallaxDirectionHint")}</em></span>
          <div>
            {["horizontal", "vertical", "orbit"].map((direction) => (
              <button className={effect.direction === direction ? "is-active" : ""} type="button" key={direction} onClick={() => update({ direction })}>
                {t(`parallaxDirection_${direction}`)}
              </button>
            ))}
          </div>
        </div>

        <ParallaxRange label={t("parallaxStrength")} value={effect.strength} min={0} max={1} step={0.01} display={(value) => `${Math.round(value * 100)}%`} low={t("parallaxSubtle")} high={t("parallaxStrong")} onChange={(strength) => update({ strength })} />
        <ParallaxRange label={t("parallaxSpeed")} value={effect.speed} min={0.35} max={2} step={0.05} display={(value) => `${value.toFixed(2)}×`} low={t("parallaxSlow")} high={t("parallaxFast")} onChange={(speed) => update({ speed })} />
        <ParallaxRange label={t("parallaxZoom")} value={effect.zoom} min={1.01} max={1.16} step={0.005} display={(value) => `${Math.round(value * 100)}%`} low={t("parallaxNatural")} high={t("parallaxImmersive")} onChange={(zoom) => update({ zoom })} />
        <ParallaxRange label={t("parallaxBackgroundSplit")} value={effect.backgroundDepth} min={0.08} max={Math.max(0.2, effect.foregroundDepth - 0.12)} step={0.01} display={(value) => `${Math.round(value * 100)}%`} low={t("depthFar")} high={t("parallaxSubject")} onChange={(backgroundDepth) => update({ backgroundDepth })} />
        <ParallaxRange label={t("parallaxForegroundSplit")} value={effect.foregroundDepth} min={Math.min(0.8, effect.backgroundDepth + 0.12)} max={0.92} step={0.01} display={(value) => `${Math.round(value * 100)}%`} low={t("parallaxSubject")} high={t("depthNear")} onChange={(foregroundDepth) => update({ foregroundDepth })} />
        <ParallaxRange label={t("parallaxEdgeFeather")} value={effect.edgeFeather} min={0.02} max={0.24} step={0.01} display={(value) => `${Math.round(value * 100)}%`} low={t("parallaxCrisp")} high={t("parallaxSoft")} onChange={(edgeFeather) => update({ edgeFeather })} />

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

      <p className="cinematic-depth-note">{t("parallaxLocalNote")}</p>
    </div>
  );
}
