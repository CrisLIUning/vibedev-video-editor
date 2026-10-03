export const VECTOR_VIEWBOX_SIZE = 1200;
const SVG_HEX_COLOR = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi;

const expandHexColor = (value) => {
  const color = String(value || "").toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  if (/^#[0-9a-f]{3}$/.test(color)) {
    return `#${color.slice(1).split("").map((digit) => `${digit}${digit}`).join("")}`;
  }
  return "";
};

export function createVectorColorSlots(body = "") {
  const colors = [];
  for (const match of String(body).match(SVG_HEX_COLOR) || []) {
    const normalized = expandHexColor(match);
    if (normalized && !colors.includes(normalized)) colors.push(normalized);
  }
  const roles = ["primary", "secondary", "accent"];
  return colors.reduce((slots, color, index) => {
    slots[roles[index % roles.length]].push(color);
    return slots;
  }, { primary: [], secondary: [], accent: [] });
}

export const createVectorSvgDataUrl = (body, background = "transparent", size = {}) => {
  const width = Math.max(1, Math.round(Number(size.width) || VECTOR_VIEWBOX_SIZE));
  const height = Math.max(1, Math.round(Number(size.height) || VECTOR_VIEWBOX_SIZE));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${VECTOR_VIEWBOX_SIZE} ${VECTOR_VIEWBOX_SIZE}"><rect width="${VECTOR_VIEWBOX_SIZE}" height="${VECTOR_VIEWBOX_SIZE}" fill="${background}"/>${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

const asset = (id, name, nameKey, category, tags, body, options = {}) => ({
  id: `vector-${id}`,
  type: "image",
  kind: "vector",
  category,
  src: createVectorSvgDataUrl(body),
  thumbnail: createVectorSvgDataUrl(body),
  vectorBody: body,
  vectorBackground: "transparent",
  vectorColorSlots: createVectorColorSlots(body),
  name,
  nameKey,
  tags,
  meta: "SVG · Transparent",
  metaKey: "vectorTransparentMeta",
  width: 1200,
  height: 1200,
  provider: "Timeline Studio",
  license: "Built-in asset",
  ...options,
});

export const VECTOR_CATEGORIES = [
  { id: "all", labelKey: "vectorCategoryAll", fallback: "All" },
  { id: "annotation", labelKey: "vectorCategoryAnnotation", fallback: "Callouts & data" },
  { id: "packaging", labelKey: "vectorCategoryPackaging", fallback: "Titles & intros" },
  { id: "mask", labelKey: "vectorCategoryMask", fallback: "Masks & layers" },
];

export const VECTOR_ASSETS = [
  asset("focus-arrow", "Focus arrow", "vectorFocusArrow", "annotation", ["arrow", "callout", "focus", "tutorial", "箭头", "标注", "重点", "教程"],
    `<defs><linearGradient id="g" x1="218" y1="940" x2="1000" y2="232"><stop stop-color="#35ead9"/><stop offset="1" stop-color="#6c7cff"/></linearGradient><filter id="s"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#031113" flood-opacity=".45"/></filter></defs><path d="M192 930c76-350 312-552 658-546V202l248 262-248 262V542c-234-4-392 122-466 388z" fill="url(#g)" filter="url(#s)"/><path d="M250 876c83-273 270-430 530-442" fill="none" stroke="#efffff" stroke-width="24" stroke-linecap="round" opacity=".62"/>`),
  asset("highlight-circle", "Highlight circle", "vectorHighlightCircle", "annotation", ["circle", "highlight", "callout", "tutorial", "圆圈", "圈出", "重点", "标注"],
    `<defs><linearGradient id="g" x1="160" y1="220" x2="1040" y2="980"><stop stop-color="#ffde59"/><stop offset=".48" stop-color="#ff7b45"/><stop offset="1" stop-color="#ff4d87"/></linearGradient><filter id="s"><feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#ff5d54" flood-opacity=".28"/></filter></defs><ellipse cx="600" cy="604" rx="430" ry="338" fill="none" stroke="url(#g)" stroke-width="56" stroke-linecap="round" stroke-dasharray="2480 180" transform="rotate(-7 600 604)" filter="url(#s)"/><path d="M935 833c58 9 111 39 150 88" fill="none" stroke="#ff5f65" stroke-width="34" stroke-linecap="round"/>`),
  asset("highlight-box", "Focus box", "vectorHighlightBox", "annotation", ["box", "highlight", "focus", "screen", "方框", "高亮", "屏幕", "教程"],
    `<defs><linearGradient id="g" x1="110" y1="170" x2="1090" y2="1030"><stop stop-color="#36f0d5"/><stop offset=".55" stop-color="#4d9cff"/><stop offset="1" stop-color="#9b6cff"/></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="14" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect x="168" y="242" width="864" height="716" rx="58" fill="#38e8d0" opacity=".07"/><path d="M350 242H226c-32 0-58 26-58 58v120M850 242h124c32 0 58 26 58 58v120M350 958H226c-32 0-58-26-58-58V780M850 958h124c32 0 58-26 58-58V780" fill="none" stroke="url(#g)" stroke-width="56" stroke-linecap="round" filter="url(#glow)"/>`),
  asset("data-chart", "Data chart", "vectorDataChart", "annotation", ["chart", "data", "finance", "bars", "trend", "图表", "数据", "财经", "柱状图"],
    `<defs><linearGradient id="b" x1="235" y1="930" x2="930" y2="285"><stop stop-color="#2ee8d6"/><stop offset="1" stop-color="#607cff"/></linearGradient><linearGradient id="l" x1="240" y1="820" x2="1010" y2="270"><stop stop-color="#ffdb57"/><stop offset="1" stop-color="#ff657d"/></linearGradient></defs><path d="M164 950H1050M164 950V230" fill="none" stroke="#b7c7d0" stroke-width="24" stroke-linecap="round" opacity=".55"/><g fill="url(#b)"><rect x="245" y="660" width="120" height="290" rx="28"/><rect x="430" y="505" width="120" height="445" rx="28"/><rect x="615" y="570" width="120" height="380" rx="28"/><rect x="800" y="335" width="120" height="615" rx="28"/></g><path d="m282 596 210-200 180 84 260-240" fill="none" stroke="url(#l)" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/><g fill="#fff"><circle cx="282" cy="596" r="24"/><circle cx="492" cy="396" r="24"/><circle cx="672" cy="480" r="24"/><circle cx="932" cy="240" r="24"/></g>`),
  asset("progress-bar", "Progress bar", "vectorProgressBar", "annotation", ["progress", "loading", "data", "status", "进度条", "数据", "状态"],
    `<defs><linearGradient id="g" x1="150" y1="600" x2="1050" y2="600"><stop stop-color="#35ead9"/><stop offset=".54" stop-color="#4c9cff"/><stop offset="1" stop-color="#9867ff"/></linearGradient></defs><rect x="115" y="492" width="970" height="216" rx="108" fill="#101a24" stroke="#81919d" stroke-opacity=".42" stroke-width="18"/><rect x="145" y="522" width="690" height="156" rx="78" fill="url(#g)"/><g fill="#fff" opacity=".35"><rect x="216" y="552" width="16" height="96" rx="8"/><rect x="326" y="552" width="16" height="96" rx="8"/><rect x="436" y="552" width="16" height="96" rx="8"/><rect x="546" y="552" width="16" height="96" rx="8"/><rect x="656" y="552" width="16" height="96" rx="8"/></g><circle cx="835" cy="600" r="34" fill="#f4fbff"/>`),
  asset("dashed-divider", "Dashed divider", "vectorDashedDivider", "annotation", ["divider", "dashed", "line", "decoration", "分割线", "虚线", "装饰"],
    `<defs><linearGradient id="g" x1="112" y1="600" x2="1088" y2="600"><stop stop-color="#35ead9" stop-opacity="0"/><stop offset=".22" stop-color="#35ead9"/><stop offset=".78" stop-color="#7282ff"/><stop offset="1" stop-color="#7282ff" stop-opacity="0"/></linearGradient></defs><path d="M100 600H1100" stroke="url(#g)" stroke-width="34" stroke-linecap="round" stroke-dasharray="82 62"/><circle cx="600" cy="600" r="62" fill="#111b26" stroke="#eefeff" stroke-width="18"/><circle cx="600" cy="600" r="20" fill="#35ead9"/>`),
  asset("avatar-frame", "Avatar frame", "vectorAvatarFrame", "annotation", ["avatar", "frame", "finance", "ring", "头像", "边框", "财经", "圆环"],
    `<defs><linearGradient id="g" x1="240" y1="186" x2="945" y2="1010"><stop stop-color="#f5d76b"/><stop offset=".34" stop-color="#ff8d4d"/><stop offset=".7" stop-color="#8a67ff"/><stop offset="1" stop-color="#35ead9"/></linearGradient><filter id="s"><feDropShadow dx="0" dy="20" stdDeviation="24" flood-color="#14101f" flood-opacity=".48"/></filter></defs><circle cx="600" cy="600" r="390" fill="none" stroke="url(#g)" stroke-width="74" filter="url(#s)"/><circle cx="600" cy="600" r="300" fill="none" stroke="#f7fbff" stroke-width="12" opacity=".72"/><g fill="#f7fbff"><circle cx="600" cy="138" r="20"/><circle cx="1062" cy="600" r="20"/><circle cx="600" cy="1062" r="20"/><circle cx="138" cy="600" r="20"/></g>`),
  asset("orbit-frame", "Orbit frame", "vectorOrbitFrame", "annotation", ["avatar", "orbit", "ring", "finance", "环形", "渐变描边", "财经", "头像"],
    `<defs><linearGradient id="g" x1="190" y1="190" x2="1020" y2="1020"><stop stop-color="#39edd7"/><stop offset=".52" stop-color="#4d96ff"/><stop offset="1" stop-color="#a469ff"/></linearGradient></defs><circle cx="600" cy="600" r="328" fill="none" stroke="#eefcff" stroke-width="16" opacity=".7"/><ellipse cx="600" cy="600" rx="475" ry="330" fill="none" stroke="url(#g)" stroke-width="40" stroke-linecap="round" stroke-dasharray="1160 460" transform="rotate(-28 600 600)"/><circle cx="948" cy="310" r="48" fill="#35ead9" stroke="#ecffff" stroke-width="15"/><circle cx="284" cy="864" r="28" fill="#9b6dff" stroke="#ecffff" stroke-width="10"/>`),

  asset("subtitle-bar", "Rounded subtitle bar", "vectorSubtitleBar", "packaging", ["subtitle", "caption", "lower third", "rounded", "字幕", "底条", "圆角矩形"],
    `<defs><linearGradient id="g" x1="116" y1="432" x2="1084" y2="768"><stop stop-color="#0f1823" stop-opacity=".96"/><stop offset="1" stop-color="#182333" stop-opacity=".88"/></linearGradient><linearGradient id="a" x1="188" y1="720" x2="990" y2="720"><stop stop-color="#35ead9"/><stop offset="1" stop-color="#687cff"/></linearGradient></defs><rect x="112" y="412" width="976" height="376" rx="92" fill="url(#g)" stroke="#fff" stroke-opacity=".16" stroke-width="12"/><rect x="184" y="690" width="832" height="20" rx="10" fill="url(#a)"/><circle cx="202" cy="538" r="22" fill="#35ead9"/><rect x="248" y="516" width="510" height="42" rx="21" fill="#f5fbff"/><rect x="184" y="594" width="702" height="30" rx="15" fill="#aebbc4" opacity=".65"/>`),
  asset("lower-third", "Clean lower third", "vectorLowerThird", "packaging", ["lower third", "title", "caption", "name", "字幕包装", "姓名条", "标题"],
    `<defs><linearGradient id="g" x1="116" y1="762" x2="1060" y2="762"><stop stop-color="#35ead9"/><stop offset=".58" stop-color="#4f96ff"/><stop offset="1" stop-color="#7b68ff" stop-opacity="0"/></linearGradient></defs><rect x="118" y="470" width="330" height="220" rx="34" fill="#35ead9"/><path d="M448 506h520l108 148H448z" fill="#111b26" stroke="#fff" stroke-opacity=".14" stroke-width="10"/><rect x="492" y="550" width="352" height="38" rx="19" fill="#f5fbff"/><rect x="492" y="612" width="228" height="24" rx="12" fill="#93a3ae"/><rect x="118" y="738" width="944" height="22" rx="11" fill="url(#g)"/>`),
  asset("gradient-shade", "Gradient shade", "vectorGradientShade", "packaging", ["gradient", "overlay", "caption", "shade", "渐变遮罩", "字幕", "遮罩"],
    `<defs><linearGradient id="g" x1="600" y1="164" x2="600" y2="1060"><stop stop-color="#071018" stop-opacity="0"/><stop offset=".5" stop-color="#071018" stop-opacity=".16"/><stop offset="1" stop-color="#071018" stop-opacity=".96"/></linearGradient><radialGradient id="a" cx="50%" cy="100%" r="70%"><stop stop-color="#326d75" stop-opacity=".4"/><stop offset="1" stop-color="#326d75" stop-opacity="0"/></radialGradient></defs><rect x="86" y="100" width="1028" height="1000" rx="70" fill="url(#g)"/><rect x="86" y="100" width="1028" height="1000" rx="70" fill="url(#a)"/><rect x="180" y="914" width="530" height="34" rx="17" fill="#fff" opacity=".9"/><rect x="180" y="980" width="720" height="22" rx="11" fill="#fff" opacity=".48"/>`),
  asset("motion-lines", "Motion line transition", "vectorMotionLines", "packaging", ["line", "transition", "motion", "intro", "动态线条", "过渡", "片头"],
    `<defs><linearGradient id="g" x1="122" y1="600" x2="1080" y2="600"><stop stop-color="#35ead9" stop-opacity="0"/><stop offset=".38" stop-color="#35ead9"/><stop offset="1" stop-color="#6e77ff"/></linearGradient><filter id="s"><feGaussianBlur stdDeviation="9"/></filter></defs><g fill="none" stroke="url(#g)" stroke-linecap="round"><path d="M80 362h690l230 238-230 238H80" stroke-width="38"/><path d="M186 454h538l142 146-142 146H186" stroke-width="24" opacity=".72"/><path d="M292 526h390l72 74-72 74H292" stroke-width="14" opacity=".48"/></g><path d="M822 366 1052 600 822 834" fill="none" stroke="#7d75ff" stroke-width="74" stroke-linecap="round" stroke-linejoin="round" filter="url(#s)" opacity=".28"/>`),
  asset("logo-placeholder", "Logo placeholder", "vectorLogoPlaceholder", "packaging", ["logo", "brand", "placeholder", "intro", "LOGO", "占位", "片头", "品牌"],
    `<defs><linearGradient id="g" x1="236" y1="224" x2="950" y2="986"><stop stop-color="#35ead9"/><stop offset=".52" stop-color="#4d97ff"/><stop offset="1" stop-color="#9a68ff"/></linearGradient></defs><rect x="204" y="204" width="792" height="792" rx="214" fill="#101a24" stroke="url(#g)" stroke-width="42"/><path d="M382 778V422h92l126 176 126-176h92v356h-102V582L600 742 484 582v196z" fill="url(#g)"/><circle cx="600" cy="600" r="462" fill="none" stroke="#f4ffff" stroke-width="12" stroke-dasharray="22 34" opacity=".32"/>`),
  asset("geometric-split", "Geometric split", "vectorGeometricSplit", "packaging", ["split", "geometry", "transition", "frame", "几何", "分割画面", "转场", "片头"],
    `<defs><linearGradient id="g1" x1="82" y1="170" x2="650" y2="1030"><stop stop-color="#35ead9"/><stop offset="1" stop-color="#3885d7"/></linearGradient><linearGradient id="g2" x1="600" y1="130" x2="1110" y2="1030"><stop stop-color="#7b6dff"/><stop offset="1" stop-color="#ee5fb8"/></linearGradient></defs><path d="M76 172h610L454 1028H76z" fill="url(#g1)"/><path d="M730 172h394v856H498z" fill="url(#g2)"/><path d="M694 160 470 1040" stroke="#f6ffff" stroke-width="24" opacity=".88"/><path d="M764 160 540 1040" stroke="#f6ffff" stroke-width="10" opacity=".34"/>`),

  asset("circle-mask", "Circle mask", "vectorCircleMask", "mask", ["mask", "circle", "avatar", "crop", "蒙版", "圆形", "头像", "遮罩"],
    `<defs><radialGradient id="g"><stop offset=".72" stop-color="#f7ffff"/><stop offset=".9" stop-color="#c9f8f3"/><stop offset="1" stop-color="#35ead9"/></radialGradient><filter id="s"><feDropShadow dx="0" dy="20" stdDeviation="24" flood-color="#061216" flood-opacity=".4"/></filter></defs><circle cx="600" cy="600" r="420" fill="url(#g)" filter="url(#s)"/><circle cx="600" cy="600" r="420" fill="none" stroke="#fff" stroke-width="16" opacity=".72"/>`,
    { maskShape: "circle" }),
  asset("rounded-mask", "Rounded rectangle mask", "vectorRoundedMask", "mask", ["mask", "rounded rectangle", "screen", "crop", "蒙版", "圆角矩形", "遮幅"],
    `<defs><linearGradient id="g" x1="190" y1="220" x2="1030" y2="1000"><stop stop-color="#f6ffff"/><stop offset=".7" stop-color="#d8fbf7"/><stop offset="1" stop-color="#6ae9dc"/></linearGradient><filter id="s"><feDropShadow dx="0" dy="22" stdDeviation="26" flood-color="#061216" flood-opacity=".42"/></filter></defs><rect x="122" y="248" width="956" height="704" rx="176" fill="url(#g)" filter="url(#s)"/><rect x="122" y="248" width="956" height="704" rx="176" fill="none" stroke="#fff" stroke-width="18" opacity=".72"/>`,
    { maskShape: "rounded" }),
  asset("arch-mask", "Arch mask", "vectorArchMask", "mask", ["mask", "arch", "portrait", "shape", "蒙版", "拱形", "人像", "异形"],
    `<defs><linearGradient id="g" x1="240" y1="170" x2="920" y2="1050"><stop stop-color="#f7ffff"/><stop offset=".72" stop-color="#d9f9ff"/><stop offset="1" stop-color="#78a8ff"/></linearGradient><filter id="s"><feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#07121d" flood-opacity=".44"/></filter></defs><path d="M600 118c249 0 450 202 450 450v500H150V568c0-248 201-450 450-450Z" fill="url(#g)" filter="url(#s)"/><path d="M600 118c249 0 450 202 450 450v500H150V568c0-248 201-450 450-450Z" fill="none" stroke="#fff" stroke-width="18" opacity=".68"/>`,
    { maskShape: "arch" }),
  asset("organic-mask", "Organic mask", "vectorOrganicMask", "mask", ["mask", "organic", "blob", "wipe", "蒙版", "异形", "画面分层", "擦除"],
    `<defs><linearGradient id="g" x1="176" y1="190" x2="1030" y2="1030"><stop stop-color="#f7ffff"/><stop offset=".58" stop-color="#d8fbf7"/><stop offset="1" stop-color="#8a77ff"/></linearGradient><filter id="s"><feDropShadow dx="0" dy="26" stdDeviation="30" flood-color="#110d25" flood-opacity=".42"/></filter></defs><path d="M952 226c148 146 117 373 59 566-56 187-253 315-448 276-201-41-392-171-421-375-28-197 123-365 280-483 165-124 382-129 530 16Z" fill="url(#g)" filter="url(#s)"/><path d="M952 226c148 146 117 373 59 566-56 187-253 315-448 276-201-41-392-171-421-375-28-197 123-365 280-483 165-124 382-129 530 16Z" fill="none" stroke="#fff" stroke-width="18" opacity=".64"/>`,
    { maskShape: "organic" }),
];

export function getVectorAssetById(id = "") {
  return VECTOR_ASSETS.find((item) => item.id === id) ?? null;
}
