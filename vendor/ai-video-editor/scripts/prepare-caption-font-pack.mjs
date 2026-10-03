import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  CAPTION_FONT_CATALOG,
  getCaptionFontsForLanguage,
} from "../src/lib/captionFonts.js";

const outputRoot = path.resolve(process.argv[2] || ".artifacts/caption-font-pack");
const languages = ["zh", "en", "ja", "ko", "es", "fr", "de", "pt", "th", "vi", "ru"];

function googleFontsDirectory(font) {
  return font.id.replaceAll("-", "");
}

function metadataFontBlocks(metadata) {
  return [...metadata.matchAll(/fonts\s*\{([\s\S]*?)\n\}/g)].map((match) => match[1]);
}

function resolveFontFilename(metadata, weight) {
  const blocks = metadataFontBlocks(metadata);
  const exact = blocks.find((block) => Number(block.match(/weight:\s*(\d+)/)?.[1]) === Number(weight));
  const selected = exact || blocks[0] || metadata;
  const filename = selected.match(/filename:\s*"([^"]+)"/)?.[1];
  if (!filename) throw new Error("No font filename found in METADATA.pb");
  return filename;
}

async function fetchRequired(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "Timeline-Studio-Font-Pack/1.0" },
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response;
}

async function downloadFont(font) {
  const directory = googleFontsDirectory(font);
  const base = `https://raw.githubusercontent.com/google/fonts/main/ofl/${directory}`;
  const metadata = await (await fetchRequired(`${base}/METADATA.pb`)).text();
  const sourceFilename = resolveFontFilename(metadata, font.weight);
  const sourceUrl = `${base}/${sourceFilename.split("/").map(encodeURIComponent).join("/")}`;
  const destination = path.join(outputRoot, "fonts", font.id);
  await mkdir(destination, { recursive: true });
  let bytes;
  let licenseText;
  try {
    [bytes, licenseText] = await Promise.all([
      readFile(path.join(destination, "font.ttf")),
      readFile(path.join(destination, "OFL.txt"), "utf8"),
    ]);
  } catch {
    const [fontBytes, downloadedLicense] = await Promise.all([
      (await fetchRequired(sourceUrl)).arrayBuffer(),
      (await fetchRequired(`${base}/OFL.txt`)).text(),
    ]);
    bytes = Buffer.from(fontBytes);
    licenseText = downloadedLicense;
    await writeFile(path.join(destination, "font.ttf"), bytes);
    await writeFile(path.join(destination, "OFL.txt"), licenseText);
  }
  return {
    id: font.id,
    family: font.family,
    label: font.label,
    weight: font.weight,
    category: font.category,
    sample: font.sample,
    path: `fonts/${font.id}/font.ttf`,
    licensePath: `fonts/${font.id}/OFL.txt`,
    license: font.license,
    source: `https://github.com/google/fonts/tree/main/ofl/${directory}`,
    sourceFilename,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

await mkdir(outputRoot, { recursive: true });
const fonts = [];
const usedFontIds = new Set(
  languages.flatMap((language) => getCaptionFontsForLanguage(language).map((font) => font.id)),
);
for (const font of CAPTION_FONT_CATALOG.filter((item) => item.id !== "default" && usedFontIds.has(item.id))) {
  process.stdout.write(`Preparing ${font.id}…\n`);
  fonts.push(await downloadFont(font));
}

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  repository: "timeline-studio-fonts",
  licensePolicy: "Each font remains under its bundled original OFL-1.1 license.",
  languages: Object.fromEntries(
    languages.map((language) => [
      language,
      getCaptionFontsForLanguage(language).filter((font) => font.id !== "default").map((font) => font.id),
    ]),
  ),
  fonts,
};

await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  path.join(outputRoot, "README.md"),
  [
    "# Timeline Studio caption fonts",
    "",
    "Versioned browser subtitle fonts for Timeline Studio.",
    "",
    "- Every font is redistributed with its original `OFL.txt`.",
    "- `manifest.json` records source, byte size, and SHA-256.",
    "- The same files must be uploaded unchanged to Hugging Face and ModelScope.",
    "- Applications must pin an immutable repository revision.",
    "",
  ].join("\n"),
);

process.stdout.write(`Prepared ${fonts.length} fonts in ${outputRoot}\n`);
