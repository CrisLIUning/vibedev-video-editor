import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [sourceDirectory, referenceDirectory, outputDirectory] = process.argv.slice(2);
if (!sourceDirectory || !referenceDirectory || !outputDirectory) {
  throw new Error("Usage: node scripts/package-hojo80-model.mjs <model-dir> <reference-dir> <output-dir>");
}

const SHARD_BYTES = 16 * 1024 * 1024;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

await mkdir(outputDirectory, { recursive: true });

async function shard(name, file) {
  const bytes = await readFile(path.join(sourceDirectory, file));
  const parts = [];
  for (let offset = 0, index = 0; offset < bytes.byteLength; offset += SHARD_BYTES, index += 1) {
    const part = bytes.subarray(offset, Math.min(offset + SHARD_BYTES, bytes.byteLength));
    const partFile = `${file}.part-${String(index).padStart(3, "0")}.bin`;
    await writeFile(path.join(outputDirectory, partFile), part);
    parts.push({ file: partFile, bytes: part.byteLength, sha256: sha256(part) });
  }
  return { name, bytes: bytes.byteLength, sha256: sha256(bytes), parts };
}

async function resource(file, source = sourceDirectory) {
  const bytes = await readFile(path.join(source, file));
  await writeFile(path.join(outputDirectory, file), bytes);
  return { file, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

const [encoder, llm, decoder] = await Promise.all([
  shard("encoder", "Hojo-TTS-Light-encoder.onnx"),
  shard("llm", "Hojo-TTS-Light-llm.onnx"),
  shard("decoder", "Hojo-TTS-Light-decoder.onnx"),
]);
const resources = await Promise.all([
  resource("config.json"),
  resource("tokenizer.json"),
  resource("tokenizer_config.json"),
  resource("reference-codes.json", referenceDirectory),
]);
const references = [
  {
    ...(await resource("zh_f_qinglan.wav", referenceDirectory)),
    voiceId: "zh_f_qinglan",
    text: "你好，欢迎测试 Hojo TTS 轻量模型。",
    codeKey: "zh_f_qinglan",
  },
  {
    ...(await resource("zh_f_ruoxi.wav", referenceDirectory)),
    voiceId: "zh_f_ruoxi",
    text: "你好，欢迎测试 Hojo TTS 轻量模型。",
    codeKey: "zh_f_ruoxi",
  },
];

const manifest = {
  format: "timeline-studio-hojo-zero-shot-runtime-v1",
  cacheIdentity: "hojo-tts-light-80m-zh-2voices-fp16-v1",
  upstream: {
    repository: "HojoAI/Hojo-TTS-Light",
    revision: "5973d74eaefa2e425ed2c3beb0fefe9871958ca6",
    codeRepository: "HojoAI/Hojo-TTS-Light",
    codeRevision: "1a6bbb88d1a72a4de82b1c9436d6e954fe3472bc",
    license: "Apache-2.0",
  },
  sampleRates: { reference: 16000, output: 24000 },
  graphs: { encoder, llm, decoder },
  resources,
  references,
};

await writeFile(path.join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await copyFile(path.join(referenceDirectory, "LICENSE.txt"), path.join(outputDirectory, "LICENSE.txt"));
await writeFile(path.join(outputDirectory, "SOURCE_NOTES.md"), `# Hojo TTS Light 80M browser bundle\n\n- Upstream model: \`HojoAI/Hojo-TTS-Light\`\n- Immutable model revision: \`5973d74eaefa2e425ed2c3beb0fefe9871958ca6\`\n- Upstream inference code revision: \`1a6bbb88d1a72a4de82b1c9436d6e954fe3472bc\`\n- License: Apache-2.0 (see \`LICENSE.txt\`)\n- Browser packaging: original FP16 ONNX graphs split into independently verified 16 MiB parts.\n- Built-in reference WAV files were generated locally with the prior Apache-2.0 Hojo 40M voices and are used only as authorized product reference profiles.\n\nThe browser worker verifies every downloaded part and reassembled graph with SHA-256 before creating WebGPU sessions. Built-in profiles use the checked-in codec tokens in \`reference-codes.json\`; the encoder shards remain available for a later authorized user-reference enrollment path without burdening ordinary synthesis.\n`);
await writeFile(path.join(outputDirectory, "README.md"), `# Hojo TTS Light 80M · Timeline Studio browser bundle\n\nZero-shot Chinese/English voice cloning for Timeline Studio. The three upstream FP16 ONNX graphs are split into 16 MiB files for parallel browser download and provider-independent caching. See \`manifest.json\` for immutable provenance and SHA-256 hashes.\n\nThis bundle includes two authorized built-in Chinese reference profiles, 晴岚 and 若溪. It does not claim explicit emotion/style control; upstream currently lists that capability as roadmap work.\n`);

console.log(JSON.stringify({ outputDirectory, cacheIdentity: manifest.cacheIdentity, graphBytes: encoder.bytes + llm.bytes + decoder.bytes, parts: encoder.parts.length + llm.parts.length + decoder.parts.length }, null, 2));
