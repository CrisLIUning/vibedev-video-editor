export function getVisualPropertyTabIds({
  isVector = false,
  isVideo = false,
  isOverlay = false,
  hasVectorEditor = false,
  isMobile = false,
} = {}) {
  if (isVector) {
    return [
      "transform",
      ...(hasVectorEditor ? ["vector"] : []),
      "animation",
      ...(isOverlay ? ["timing"] : []),
    ];
  }
  return [
    "transform",
    "mask",
    "filters",
    "animation",
    ...(isMobile && isVideo ? ["speed"] : []),
    ...(!isMobile && !isOverlay && isVideo ? ["speedCurve"] : []),
    ...(!isMobile && !isOverlay ? ["colorWheels"] : []),
    ...(isOverlay ? ["timing"] : ["repair"]),
  ];
}
