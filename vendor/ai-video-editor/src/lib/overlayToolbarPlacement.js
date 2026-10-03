export function getOverlayToolbarPosition({
  frameWidth,
  frameHeight,
  centerX,
  centerY,
  width,
  height,
  rotation = 0,
  toolbarWidth = 68,
  toolbarHeight = 32,
  gap = 8,
  safeInset = 6,
}) {
  const safeFrameWidth = Math.max(1, Number(frameWidth) || 1);
  const safeFrameHeight = Math.max(1, Number(frameHeight) || 1);
  const radians = (Number(rotation) || 0) * Math.PI / 180;
  const rotatedWidth = Math.abs((Number(width) || 0) * Math.cos(radians))
    + Math.abs((Number(height) || 0) * Math.sin(radians));
  const rotatedHeight = Math.abs((Number(height) || 0) * Math.cos(radians))
    + Math.abs((Number(width) || 0) * Math.sin(radians));
  const belowTop = centerY + rotatedHeight / 2 + gap;
  const aboveTop = centerY - rotatedHeight / 2 - gap - toolbarHeight;
  const placement = belowTop + toolbarHeight <= safeFrameHeight - safeInset ? "below" : "above";
  const preferredTop = placement === "below" ? belowTop : aboveTop;
  const aboveDirection = centerX <= safeFrameWidth / 2 ? 1 : -1;
  const aboveCenterX = centerX + aboveDirection * Math.max(toolbarWidth / 2 + 18, rotatedWidth / 2 - toolbarWidth / 2);
  const preferredCenterX = placement === "below" ? centerX : aboveCenterX;

  return {
    left: Math.max(toolbarWidth / 2 + safeInset, Math.min(safeFrameWidth - toolbarWidth / 2 - safeInset, preferredCenterX)),
    top: Math.max(safeInset, Math.min(safeFrameHeight - toolbarHeight - safeInset, preferredTop)),
    placement,
  };
}
