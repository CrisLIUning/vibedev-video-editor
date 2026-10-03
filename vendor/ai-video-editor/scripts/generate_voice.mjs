#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env as transformersEnv, RawAudio } from "@huggingface/transformers";
import { KokoroTTS, TextSplitterStream } from "kokoro-js";

const HUGGING_FACE_REVISION = "8471955b41238ec0b231d0e3e8e3ac852be6652b";
const MODELSCOPE_REVISION = "e0fc307e4890369527cadd10ed4f6af81fd085b3";
const MODEL_PATH = "kokoro";

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    values[key] = value;
    index += 1;
  }
  return values;
}

function sourceCandidates(preference) {
  const sources = {
    huggingface: {
      id: "huggingface",
      base: `https://huggingface.co/haixin/timeline-studio-voice-models/resolve/${HUGGING_FACE_REVISION}/`,
    },
    modelscope: {
      id: "modelscope",
      base: `https://www.modelscope.cn/models/martindelophy/timeline-studio-voice-models/resolve/${MODELSCOPE_REVISION}/`,
    },
  };
  return preference === "modelscope"
    ? [sources.modelscope, sources.huggingface]
    : [sources.huggingface, sources.modelscope];
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${new URL(url).hostname}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function verifyOwnedVoiceStyle(voiceId, candidates, cacheDir) {
  const entryUrl = import.meta.resolve("kokoro-js");
  const packageVoicePath = resolve(dirname(fileURLToPath(entryUrl)), "../voices", `${voiceId}.bin`);
  const bundledBytes = await readFile(packageVoicePath);
  const verifiedPath = resolve(cacheDir, "voices", `${voiceId}.bin`);
  try {
    const cachedBytes = await readFile(verifiedPath);
    if (sha256(cachedBytes) === sha256(bundledBytes)) return "cache";
  } catch {
    // Download and verify only when the provider-independent cached style is missing or invalid.
  }
  const failures = [];
  for (const source of candidates) {
    try {
      const ownedBytes = await fetchBytes(`${source.base}kokoro/voices/${voiceId}.bin`);
      if (sha256(ownedBytes) !== sha256(bundledBytes)) {
        throw new Error("owned voice style does not match the installed runtime style");
      }
      await mkdir(dirname(verifiedPath), { recursive: true });
      await writeFile(verifiedPath, ownedBytes);
      return source.id;
    } catch (error) {
      failures.push(`${source.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Unable to verify owned voice style. ${failures.join("; ")}`);
}

async function loadOwnedModel(candidates, cacheDir) {
  transformersEnv.cacheDir = cacheDir;
  transformersEnv.allowLocalModels = true;
  transformersEnv.useBrowserCache = false;
  const failures = [];
  for (const source of candidates) {
    transformersEnv.remoteHost = source.base;
    transformersEnv.remotePathTemplate = "{model}/";
    try {
      const model = await KokoroTTS.from_pretrained(MODEL_PATH, {
        dtype: "q8",
        device: "cpu",
        progress_callback: (event) => {
          if (event?.status === "progress" && Number.isFinite(event.progress)) {
            process.stderr.write(`\r${source.id}: ${Math.round(event.progress)}% ${event.file || ""}`);
          }
        },
      });
      process.stderr.write("\n");
      return { model, source: source.id };
    } catch (error) {
      process.stderr.write("\n");
      failures.push(`${source.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Unable to load owned Kokoro model. ${failures.join("; ")}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args["text-file"] || !args.output) {
    throw new Error("Usage: node scripts/generate_voice.mjs --text-file narration.txt --output narration.wav [--voice af_heart] [--speed 1] [--sentence-gap 0.22] [--allow-fast yes] [--provider huggingface|modelscope]");
  }
  const voiceId = args.voice || "af_heart";
  const speed = Number(args.speed || 1);
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new Error("--speed must be between 0.5 and 2");
  const allowFast = args["allow-fast"] === "yes";
  if (speed > 1.15 && !allowFast) throw new Error("Natural narration guard: --speed above 1.15 requires --allow-fast yes");
  const sentenceGapSeconds = Number(args["sentence-gap"] || 0.22);
  if (!Number.isFinite(sentenceGapSeconds) || sentenceGapSeconds < 0.12 || sentenceGapSeconds > 0.5) {
    throw new Error("--sentence-gap must be between 0.12 and 0.5 seconds");
  }
  const provider = args.provider === "modelscope" ? "modelscope" : "huggingface";
  const candidates = sourceCandidates(provider);
  const cacheDir = resolve(args["cache-dir"] || ".cache/timeline-studio-voice-models");
  const outputPath = resolve(args.output);
  const text = (await readFile(resolve(args["text-file"]), "utf8")).trim();
  if (!text) throw new Error("Narration text is empty");

  const voiceSource = await verifyOwnedVoiceStyle(voiceId, candidates, cacheDir);
  const { model, source: modelSource } = await loadOwnedModel(candidates, cacheDir);
  const chunks = [];
  let sampleRate = 24000;
  const splitter = new TextSplitterStream();
  splitter.push(text);
  splitter.close();
  for await (const result of model.stream(splitter, { voice: voiceId, speed })) {
    const samples = result?.audio?.audio;
    if (!(samples instanceof Float32Array) || !samples.length) continue;
    sampleRate = Number(result.audio.sampling_rate) || sampleRate;
    chunks.push(samples);
  }
  if (!chunks.length) throw new Error("Voice model returned no audio");
  const sentenceGap = Math.round(sampleRate * sentenceGapSeconds);
  const totalSamples = chunks.reduce((total, chunk) => total + chunk.length, 0) + sentenceGap * Math.max(0, chunks.length - 1);
  const combined = new Float32Array(totalSamples);
  let offset = 0;
  chunks.forEach((chunk, index) => {
    combined.set(chunk, offset);
    offset += chunk.length;
    if (index < chunks.length - 1) offset += sentenceGap;
  });
  const audio = new RawAudio(combined, sampleRate);
  const duration = combined.length / sampleRate;
  const wordCount = (text.match(/\b[\w’'-]+\b/g) || []).length;
  const wordsPerMinute = duration > 0 ? wordCount * 60 / duration : 0;
  if (wordsPerMinute > 165 && !allowFast) {
    throw new Error(`Natural narration guard: ${wordsPerMinute.toFixed(1)} words per minute exceeds 165; shorten the script or use --allow-fast yes`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await audio.save(outputPath);
  process.stdout.write(JSON.stringify({ output: outputPath, voiceId, speed, sentenceGapSeconds, sentenceCount: chunks.length, duration, wordCount, wordsPerMinute, modelSource, voiceSource }) + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
