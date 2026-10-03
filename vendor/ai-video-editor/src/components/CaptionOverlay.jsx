import { useEffect, useMemo, useRef, useState } from "react";

import { ensureCaptionFontLoaded } from "../lib/captionFonts.js";
import { drawCaptionLayout, getCaptionTextLayout } from "../lib/captionLayout.js";

const FALLBACK_PREVIEW_FRAME = { width: 640, height: 360 };

function getCaptionRasterScale() {
  if (typeof window === "undefined") return 2;
  // Canvas text on Windows uses grayscale antialiasing instead of ClearType.
  // A 2x minimum backing store keeps downloaded fonts crisp at 100–150% OS
  // scaling, while the upper bound avoids waste at extreme browser zoom.
  return Math.max(2, Math.min(4, Number(window.devicePixelRatio) || 1));
}

function snapToPhysicalPixel(value, devicePixelRatio) {
  const ratio = Math.max(1, Number(devicePixelRatio) || 1);
  return Math.round(value * ratio) / ratio;
}

export function CaptionOverlay({
  text,
  captionSize,
  captionStyle,
  placement,
  frameSize,
  onPointerDown,
  onDoubleClick,
}) {
  const canvasRef = useRef(null);
  const [fontRevision, setFontRevision] = useState(0);
  const [fontStatus, setFontStatus] = useState("ready");
  const renderFrame =
    frameSize?.width > 0 && frameSize?.height > 0 ? frameSize : FALLBACK_PREVIEW_FRAME;
  useEffect(() => {
    let canceled = false;
    const fontId = captionStyle?.fontId || "default";
    if (fontId === "default") {
      setFontStatus("ready");
      return undefined;
    }
    setFontStatus("loading");
    ensureCaptionFontLoaded(captionStyle?.fontId, text)
      .then(() => {
        if (!canceled) {
          setFontStatus("ready");
          setFontRevision((value) => value + 1);
        }
      })
      .catch(() => {
        if (!canceled) {
          setFontStatus("failed");
          setFontRevision((value) => value + 1);
        }
      });
    return () => {
      canceled = true;
    };
  }, [captionStyle?.fontId, text]);
  const layout = useMemo(
    () => {
      // Font pixels change after the asynchronous face load even when the
      // selected font id and text stay the same, so this revision deliberately
      // invalidates the cached measurements.
      void fontRevision;
      return getCaptionTextLayout({
        text,
        captionSize,
        captionStyle,
        referenceFrame: renderFrame,
        renderFrame,
      });
    },
    [captionSize, captionStyle, fontRevision, renderFrame, text],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout.width || !layout.height) {
      return;
    }

    const rasterScale = getCaptionRasterScale();
    canvas.width = Math.max(1, Math.round(layout.width * rasterScale));
    canvas.height = Math.max(1, Math.round(layout.height * rasterScale));
    canvas.style.width = `${layout.width}px`;
    canvas.style.height = `${layout.height}px`;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      return;
    }
    // Use the real backing-store ratio after integer rounding. Scaling by the
    // requested ratio can leave a fractional unused strip that the browser
    // resamples across the complete canvas, softening glyph edges.
    context.setTransform(canvas.width / layout.width, 0, 0, canvas.height / layout.height, 0, 0);
    if ("fontKerning" in context) context.fontKerning = "normal";
    if ("textRendering" in context) context.textRendering = "optimizeLegibility";
    drawCaptionLayout(context, layout);
  }, [layout]);

  const devicePixelRatio = typeof window === "undefined" ? 1 : Math.max(1, Number(window.devicePixelRatio) || 1);
  const placementX = Number(placement?.x);
  const placementY = Number(placement?.y);
  const left = Number.isFinite(placementX)
    ? `${snapToPhysicalPixel((renderFrame.width * placementX) / 100, devicePixelRatio)}px`
    : `${placementX || 50}%`;
  const top = Number.isFinite(placementY)
    ? `${snapToPhysicalPixel((renderFrame.height * placementY) / 100, devicePixelRatio)}px`
    : `${placementY || 78}%`;

  return (
    <button
      className={`caption-overlay ${fontStatus === "loading" ? "is-font-loading" : ""}`}
      type="button"
      aria-label={text}
      aria-busy={fontStatus === "loading"}
      style={{
        width: `${layout.width}px`,
        height: `${layout.height}px`,
        borderRadius: `${layout.metrics.radius}px`,
        left,
        top,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
      {fontStatus === "loading" ? <span className="caption-font-loading-indicator" aria-hidden="true" /> : null}
    </button>
  );
}
