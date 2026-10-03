import { createVectorSvgDataUrl, VECTOR_VIEWBOX_SIZE } from "./vectorAssets.js";

const RENDERABLE_TAGS = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "g",
]);

const SHAPE_SELECTOR = "path,rect,circle,ellipse,line,polyline,polygon,text";
const INTERNAL_PART_ID = /^vector-part-\d+$/;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, toNumber(value, min)));

function createParserEnvironment(environment = globalThis) {
  const Parser = environment?.DOMParser;
  const Serializer = environment?.XMLSerializer;
  if (!Parser || !Serializer) return null;
  return { Parser, Serializer };
}

function parseBody(body, environment = globalThis) {
  const constructors = createParserEnvironment(environment);
  if (!constructors) return null;
  const document = new constructors.Parser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VECTOR_VIEWBOX_SIZE} ${VECTOR_VIEWBOX_SIZE}"><g data-vector-document-root="true">${String(body || "")}</g></svg>`,
    "image/svg+xml",
  );
  if (document.querySelector("parsererror")) return null;
  const root = document.querySelector('[data-vector-document-root="true"]');
  return root ? { document, root, Serializer: constructors.Serializer } : null;
}

function serializeRoot(root, Serializer) {
  const serializer = new Serializer();
  return [...root.childNodes].map((node) => serializer.serializeToString(node)).join("");
}

function directRenderableChildren(element) {
  return [...element.children].filter((child) => RENDERABLE_TAGS.has(child.localName?.toLowerCase()));
}

function hasVisibleShape(element) {
  const tag = element.localName?.toLowerCase();
  return tag !== "g" || Boolean(element.querySelector(SHAPE_SELECTOR));
}

function findPartContainer(root) {
  let container = root;
  for (let depth = 0; depth < 6; depth += 1) {
    const children = directRenderableChildren(container).filter(hasVisibleShape);
    if (children.length !== 1 || children[0].localName?.toLowerCase() !== "g") break;
    container = children[0];
  }
  return container;
}

function normalizeSemanticName(value = "") {
  if (value == null) return "";
  const name = String(value)
    .replace(/^vector[-_:]?/i, "")
    .replace(/[-_:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || INTERNAL_PART_ID.test(name) || /^(g|group|path|shape)\s*\d*$/i.test(name)) return "";
  return name.slice(0, 42);
}

function getElementSemanticName(element) {
  const title = [...element.children].find((child) => child.localName?.toLowerCase() === "title")?.textContent;
  return normalizeSemanticName(
    element.getAttribute("data-vector-name")
      || element.getAttribute("data-name")
      || element.getAttribute("aria-label")
      || title
      || element.getAttribute("id"),
  );
}

function getShapeElements(element) {
  const tag = element.localName?.toLowerCase();
  return [
    ...(tag && tag !== "g" && RENDERABLE_TAGS.has(tag) ? [element] : []),
    ...element.querySelectorAll(SHAPE_SELECTOR),
  ];
}

function getPaintValue(element, attribute) {
  const direct = String(element.getAttribute(attribute) || "").trim();
  if (direct) return direct;
  const style = String(element.getAttribute("style") || "");
  const match = style.match(new RegExp(`(?:^|;)\\s*${attribute}\\s*:\\s*([^;]+)`, "i"));
  return String(match?.[1] || "").trim();
}

function isStrokeShape(element) {
  const tag = element.localName?.toLowerCase();
  const stroke = getPaintValue(element, "stroke");
  const fill = getPaintValue(element, "fill");
  return ["line", "polyline"].includes(tag) || (Boolean(stroke) && stroke !== "none" && fill === "none");
}

export function inferVectorPartKind(input = {}) {
  const tag = String(input.tag || "").toLowerCase();
  const childTags = Array.isArray(input.childTags) ? input.childTags.map((value) => String(value).toLowerCase()) : [];
  const strokeOnly = input.strokeOnly === true;
  if (tag === "text") return "text";
  if (tag === "rect") return "rectangle";
  if (tag === "circle" || tag === "ellipse") return "circle";
  if (tag === "line" || tag === "polyline" || strokeOnly) return "line";
  if (tag === "polygon") return "shape";
  if (tag === "path") return strokeOnly ? "line" : "shape";
  if (tag === "g") {
    if (childTags.length && childTags.every((child) => child === "rect")) return "rectangleGroup";
    if (childTags.length && childTags.every((child) => child === "circle" || child === "ellipse")) return "pointGroup";
    if (childTags.length && childTags.every((child) => ["line", "polyline", "path"].includes(child)) && strokeOnly) return "lineGroup";
    if (childTags.includes("text") && childTags.every((child) => child === "text" || child === "tspan")) return "textGroup";
    return "group";
  }
  return "shape";
}

function createPartRecord(element, index) {
  const shapes = getShapeElements(element);
  const tag = element.localName?.toLowerCase() || "g";
  const childTags = shapes.map((shape) => shape.localName?.toLowerCase()).filter(Boolean);
  const strokeShapes = shapes.filter(isStrokeShape);
  const strokeTarget = strokeShapes[0];
  const paintTarget = shapes.find((shape) => {
    const fill = getPaintValue(shape, "fill");
    const stroke = getPaintValue(shape, "stroke");
    return (fill && fill !== "none") || (stroke && stroke !== "none");
  }) || shapes[0];
  const colorValue = paintTarget
    ? (isStrokeShape(paintTarget) ? getPaintValue(paintTarget, "stroke") : getPaintValue(paintTarget, "fill") || getPaintValue(paintTarget, "stroke"))
    : "";
  return {
    id: element.getAttribute("data-vector-part-id"),
    name: getElementSemanticName(element),
    kind: inferVectorPartKind({
      tag,
      childTags,
      strokeOnly: strokeShapes.length > 0 && strokeShapes.length === Math.max(1, shapes.length),
    }),
    index,
    count: Math.max(1, shapes.length),
    color: /^#[0-9a-f]{6}$/i.test(colorValue) ? colorValue.toLowerCase() : "#35ead9",
    strokeWidth: clamp(strokeTarget?.getAttribute("stroke-width") || 4, 1, 120),
    opacity: clamp(element.getAttribute("opacity") || 1, 0, 1),
    translateX: toNumber(element.getAttribute("data-vector-translate-x"), 0),
    translateY: toNumber(element.getAttribute("data-vector-translate-y"), 0),
    scale: clamp(element.getAttribute("data-vector-scale") || 1, 0.1, 5),
    shadowEnabled: element.getAttribute("data-vector-shadow") === "true",
    supportsColor: Boolean(paintTarget),
    supportsStroke: Boolean(strokeTarget),
    supportsTransform: true,
    supportsShadow: true,
  };
}

export function createEditableVectorDocument(body = "", environment = globalThis) {
  const parsed = parseBody(body, environment);
  if (!parsed) return { body: String(body || ""), parts: [], supported: false };
  const container = findPartContainer(parsed.root);
  const candidates = directRenderableChildren(container).filter(hasVisibleShape);
  const usedIds = new Set();
  let nextId = 1;
  for (const element of candidates) {
    const existing = element.getAttribute("data-vector-part-id");
    let id = INTERNAL_PART_ID.test(existing || "") && !usedIds.has(existing) ? existing : "";
    while (!id) {
      const candidate = `vector-part-${nextId++}`;
      if (!usedIds.has(candidate)) id = candidate;
    }
    usedIds.add(id);
    element.setAttribute("data-vector-part-id", id);
    element.setAttribute("role", "button");
    element.setAttribute("tabindex", "0");
  }
  const parts = candidates.map(createPartRecord);
  return {
    body: serializeRoot(parsed.root, parsed.Serializer),
    parts,
    supported: parts.length > 0,
  };
}

function findPartNode(parsed, partId) {
  if (!INTERNAL_PART_ID.test(String(partId || ""))) return null;
  return parsed.root.querySelector(`[data-vector-part-id="${partId}"]`);
}

function setStyleProperty(element, property, value) {
  const declarations = String(element.getAttribute("style") || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(":");
      return separator > 0 ? [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()] : null;
    })
    .filter(Boolean);
  const styles = new Map(declarations);
  if (value) styles.set(property, value);
  else styles.delete(property);
  const serialized = [...styles].map(([key, entryValue]) => `${key}:${entryValue}`).join(";");
  if (serialized) element.setAttribute("style", serialized);
  else element.removeAttribute("style");
}

function getEditablePaintTargets(node) {
  const shapes = getShapeElements(node);
  return shapes.length ? shapes : [node];
}

function applyPartColor(node, color) {
  if (!/^#[0-9a-f]{6}$/i.test(String(color || ""))) return;
  const targets = getEditablePaintTargets(node);
  for (const target of targets) {
    const fill = getPaintValue(target, "fill");
    const stroke = getPaintValue(target, "stroke");
    const tag = target.localName?.toLowerCase();
    if (["line", "polyline"].includes(tag) || (stroke && stroke !== "none" && fill === "none")) {
      target.setAttribute("stroke", color);
    } else if (fill !== "none") {
      target.setAttribute("fill", color);
    } else if (stroke && stroke !== "none") {
      target.setAttribute("stroke", color);
    }
  }
}

function applyPartStrokeWidth(node, width) {
  const normalized = clamp(width, 1, 120);
  for (const target of getEditablePaintTargets(node)) {
    if (isStrokeShape(target) || (getPaintValue(target, "stroke") && getPaintValue(target, "stroke") !== "none")) {
      target.setAttribute("stroke-width", String(normalized));
    }
  }
}

function applyPartTransform(node, patch) {
  const baseTransform = node.hasAttribute("data-vector-base-transform")
    ? node.getAttribute("data-vector-base-transform")
    : String(node.getAttribute("transform") || "");
  if (!node.hasAttribute("data-vector-base-transform")) node.setAttribute("data-vector-base-transform", baseTransform);
  const translateX = clamp(patch.translateX ?? node.getAttribute("data-vector-translate-x") ?? 0, -1200, 1200);
  const translateY = clamp(patch.translateY ?? node.getAttribute("data-vector-translate-y") ?? 0, -1200, 1200);
  const scale = clamp(patch.scale ?? node.getAttribute("data-vector-scale") ?? 1, 0.1, 5);
  node.setAttribute("data-vector-translate-x", String(translateX));
  node.setAttribute("data-vector-translate-y", String(translateY));
  node.setAttribute("data-vector-scale", String(scale));
  node.setAttribute("transform", `${baseTransform} translate(${translateX} ${translateY}) scale(${scale})`.trim());
}

export function updateVectorPart(body = "", partId, patch = {}, environment = globalThis) {
  const parsed = parseBody(body, environment);
  if (!parsed) return createEditableVectorDocument(body, environment);
  const node = findPartNode(parsed, partId);
  if (!node) return createEditableVectorDocument(body, environment);
  if (patch.color != null) applyPartColor(node, patch.color);
  if (patch.strokeWidth != null) applyPartStrokeWidth(node, patch.strokeWidth);
  if (patch.opacity != null) node.setAttribute("opacity", String(clamp(patch.opacity, 0, 1)));
  if (patch.translateX != null || patch.translateY != null || patch.scale != null) applyPartTransform(node, patch);
  if (patch.shadowEnabled != null) {
    const enabled = patch.shadowEnabled === true;
    node.setAttribute("data-vector-shadow", String(enabled));
    setStyleProperty(node, "filter", enabled ? "drop-shadow(0px 12px 16px rgba(0,0,0,.55))" : "");
  }
  return createEditableVectorDocument(serializeRoot(parsed.root, parsed.Serializer), environment);
}

export function createVectorSelectionBody(body = "", selectedPartId = "", environment = globalThis) {
  const parsed = parseBody(body, environment);
  if (!parsed) return String(body || "");
  for (const element of parsed.root.querySelectorAll("[data-vector-selected]")) element.removeAttribute("data-vector-selected");
  const selected = findPartNode(parsed, selectedPartId);
  if (selected) selected.setAttribute("data-vector-selected", "true");
  return serializeRoot(parsed.root, parsed.Serializer);
}

export function createVectorPartThumbnail(body = "", partId = "", environment = globalThis) {
  const parsed = parseBody(body, environment);
  if (!parsed) return createVectorSvgDataUrl(body);
  const partNodes = [...parsed.root.querySelectorAll("[data-vector-part-id]")];
  for (const node of partNodes) {
    if (node.getAttribute("data-vector-part-id") !== partId) {
      node.setAttribute("opacity", "0.08");
    } else {
      node.setAttribute("data-vector-selected", "true");
    }
    node.removeAttribute("role");
    node.removeAttribute("tabindex");
  }
  return createVectorSvgDataUrl(serializeRoot(parsed.root, parsed.Serializer));
}
