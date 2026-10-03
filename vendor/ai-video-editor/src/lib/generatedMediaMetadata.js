const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const WEBM_SIGNATURE = Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3);
const SEGMENT_ID = Uint8Array.of(0x18, 0x53, 0x80, 0x67);
const CLUSTER_ID = Uint8Array.of(0x1f, 0x43, 0xb6, 0x75);
const textEncoder = new TextEncoder();
export const FACE_SWAP_DISCLOSURE = "AI-generated face swap – deepfake demo (not real footage)";

function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function matchesAt(bytes, signature, offset = 0) {
  if (offset < 0 || offset + signature.length > bytes.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function uint32Bytes(value) {
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function createPngChunk(type, data) {
  const typeBytes = textEncoder.encode(type);
  const body = concatBytes([typeBytes, data]);
  return concatBytes([uint32Bytes(data.length), body, uint32Bytes(crc32(body))]);
}

function createPngInternationalText(keyword, value) {
  return createPngChunk("iTXt", concatBytes([
    textEncoder.encode(keyword),
    Uint8Array.of(0, 0, 0, 0, 0),
    textEncoder.encode(value),
  ]));
}

function embedPngMetadata(bytes, metadata) {
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
    const dataLength = view.getUint32(0);
    const chunkEnd = offset + 12 + dataLength;
    if (chunkEnd > bytes.length) throw new Error("FACE_SWAP_METADATA_INVALID_PNG");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "IEND") {
      const chunk = createPngInternationalText("AIGC", JSON.stringify(metadata));
      return concatBytes([bytes.subarray(0, offset), chunk, bytes.subarray(offset)]);
    }
    offset = chunkEnd;
  }
  throw new Error("FACE_SWAP_METADATA_INVALID_PNG");
}

function encodeEbmlSize(value, forcedWidth = 0) {
  const normalized = BigInt(value);
  let width = forcedWidth;
  if (!width) {
    for (width = 1; width <= 8; width += 1) {
      if (normalized <= (1n << BigInt(7 * width)) - 2n) break;
    }
  }
  if (width < 1 || width > 8 || normalized > (1n << BigInt(7 * width)) - 2n) {
    throw new Error("FACE_SWAP_METADATA_WEBM_SIZE_OVERFLOW");
  }
  let encoded = normalized | (1n << BigInt(7 * width));
  const result = new Uint8Array(width);
  for (let index = width - 1; index >= 0; index -= 1) {
    result[index] = Number(encoded & 0xffn);
    encoded >>= 8n;
  }
  return result;
}

function readEbmlSize(bytes, offset) {
  const first = bytes[offset];
  if (first === undefined || first === 0) throw new Error("FACE_SWAP_METADATA_INVALID_WEBM");
  let width = 1;
  let marker = 0x80;
  while (width <= 8 && !(first & marker)) {
    width += 1;
    marker >>= 1;
  }
  if (width > 8 || offset + width > bytes.length) throw new Error("FACE_SWAP_METADATA_INVALID_WEBM");
  let value = BigInt(first & (marker - 1));
  for (let index = 1; index < width; index += 1) value = (value << 8n) | BigInt(bytes[offset + index]);
  const unknownValue = (1n << BigInt(7 * width)) - 1n;
  return { unknown: value === unknownValue, value, width };
}

function createEbmlElement(id, data) {
  return concatBytes([id, encodeEbmlSize(data.length), data]);
}

function createWebmSimpleTag(name, value) {
  return createEbmlElement(Uint8Array.of(0x67, 0xc8), concatBytes([
    createEbmlElement(Uint8Array.of(0x45, 0xa3), textEncoder.encode(name)),
    createEbmlElement(Uint8Array.of(0x44, 0x87), textEncoder.encode(value)),
  ]));
}

function createWebmTags(metadata) {
  const entries = [
    ["AIGC_GENERATION_TYPE", metadata.generationType],
    ["AIGC_TOOL", metadata.toolName],
    ["AIGC_CREATED_AT", metadata.createdAt],
    ["AIGC_CONTENT_ID", metadata.contentId],
    ["AIGC_GENERATOR", metadata.generator],
    ["AIGC_DISCLOSURE", metadata.disclosure],
    ["AIGC_METADATA", JSON.stringify(metadata)],
  ];
  const tag = createEbmlElement(Uint8Array.of(0x73, 0x73), concatBytes([
    createEbmlElement(Uint8Array.of(0x63, 0xc0), new Uint8Array()),
    ...entries.map(([name, value]) => createWebmSimpleTag(name, String(value || ""))),
  ]));
  return createEbmlElement(Uint8Array.of(0x12, 0x54, 0xc3, 0x67), tag);
}

function findSegmentOffset(bytes) {
  const limit = Math.min(bytes.length - SEGMENT_ID.length, 4096);
  for (let offset = WEBM_SIGNATURE.length; offset <= limit; offset += 1) {
    if (matchesAt(bytes, SEGMENT_ID, offset)) return offset;
  }
  return -1;
}

function findBytes(bytes, signature, start, end) {
  const limit = Math.min(bytes.length, end) - signature.length;
  for (let offset = start; offset <= limit; offset += 1) {
    if (matchesAt(bytes, signature, offset)) return offset;
  }
  return -1;
}

function embedWebmMetadata(bytes, metadata) {
  const segmentOffset = findSegmentOffset(bytes);
  if (segmentOffset < 0) throw new Error("FACE_SWAP_METADATA_INVALID_WEBM");
  const sizeOffset = segmentOffset + SEGMENT_ID.length;
  const size = readEbmlSize(bytes, sizeOffset);
  const payloadOffset = sizeOffset + size.width;
  const tags = createWebmTags(metadata);
  if (!size.unknown && size.value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("FACE_SWAP_METADATA_INVALID_WEBM");
  }
  const segmentEnd = size.unknown ? bytes.length : payloadOffset + Number(size.value);
  if (segmentEnd > bytes.length) throw new Error("FACE_SWAP_METADATA_INVALID_WEBM");
  const clusterOffset = findBytes(bytes, CLUSTER_ID, payloadOffset, segmentEnd);
  const insertionOffset = clusterOffset >= 0 ? clusterOffset : segmentEnd;
  if (size.unknown) {
    return concatBytes([
      bytes.subarray(0, insertionOffset),
      tags,
      bytes.subarray(insertionOffset),
    ]);
  }
  const updatedSize = encodeEbmlSize(size.value + BigInt(tags.length), size.width);
  return concatBytes([
    bytes.subarray(0, sizeOffset),
    updatedSize,
    bytes.subarray(payloadOffset, insertionOffset),
    tags,
    bytes.subarray(insertionOffset, segmentEnd),
    bytes.subarray(segmentEnd),
  ]);
}

export function createGeneratedMediaMetadata({
  contentId,
  createdAt = new Date().toISOString(),
  generationType = "face-swap",
  generator = "mobilefaceswap-224",
  toolName = "Timeline Studio",
  disclosure = FACE_SWAP_DISCLOSURE,
} = {}) {
  if (!contentId) throw new TypeError("contentId is required");
  return Object.freeze({
    schemaVersion: "1.0",
    generationType,
    toolName,
    createdAt,
    contentId,
    generator,
    disclosure,
  });
}

export function createGeneratedExportMetadata({
  contentId = crypto.randomUUID(),
  createdAt = new Date().toISOString(),
  visualSegments = [],
  visualOverlaySegments = [],
} = {}) {
  const sources = [...visualSegments, ...visualOverlaySegments]
    .map((segment) => segment?.generationMetadata)
    .filter((metadata) => metadata?.contentId);
  if (!sources.length) return null;
  const uniqueSources = [...new Map(sources.map((metadata) => [metadata.contentId, metadata])).values()];
  const generationTypes = [...new Set(uniqueSources.map((metadata) => metadata.generationType).filter(Boolean))];
  const generators = [...new Set(uniqueSources.map((metadata) => metadata.generator).filter(Boolean))];
  return Object.freeze({
    schemaVersion: "1.0",
    generationType: generationTypes.length === 1 ? generationTypes[0] : "ai-composite",
    toolName: "Timeline Studio",
    createdAt,
    contentId,
    generator: generators.length === 1 ? generators[0] : "timeline-studio-compositor",
    disclosure: FACE_SWAP_DISCLOSURE,
    sourceContentIds: uniqueSources.map((metadata) => metadata.contentId),
  });
}

export function getGeneratedMediaTags(metadata) {
  if (!metadata) return null;
  const serialized = JSON.stringify(metadata);
  return {
    description: metadata.disclosure || FACE_SWAP_DISCLOSURE,
    date: new Date(metadata.createdAt),
    comment: serialized,
    raw: {
      AIGC_GENERATION_TYPE: String(metadata.generationType || ""),
      AIGC_TOOL: String(metadata.toolName || ""),
      AIGC_CREATED_AT: String(metadata.createdAt || ""),
      AIGC_CONTENT_ID: String(metadata.contentId || ""),
      AIGC_GENERATOR: String(metadata.generator || ""),
      AIGC_DISCLOSURE: String(metadata.disclosure || FACE_SWAP_DISCLOSURE),
      AIGC_METADATA: serialized,
    },
  };
}

export async function embedGeneratedMediaMetadata(blob, metadata) {
  if (!(blob instanceof Blob)) throw new TypeError("A Blob is required");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let embedded;
  if (matchesAt(bytes, PNG_SIGNATURE)) embedded = embedPngMetadata(bytes, metadata);
  else if (matchesAt(bytes, WEBM_SIGNATURE)) embedded = embedWebmMetadata(bytes, metadata);
  else throw new Error("FACE_SWAP_METADATA_UNSUPPORTED_FORMAT");
  return new Blob([embedded], { type: blob.type });
}
