// FORK: features VibeDev's builds leave out until the licences of the models
// they download are settled. The code stays; only their entry points are
// hidden, so turning one back on is a one-line change here.
//
// - Face swap (MobileFaceSwap 224): its identity encoder comes from InsightFace,
//   whose pretrained models are for non-commercial research only.
// - AI music (Stable Audio Small): Stability AI Community License, which has
//   revenue limits and attribution terms nobody has signed off on yet.
export const FACE_SWAP_ENABLED = false;
export const AI_MUSIC_ENABLED = false;

// Speech front ends built on eSpeak NG, which is GPL-3.0-or-later. These two
// go further than hiding: with the flag off the import that loads the GPL code
// is unreachable, so the bundler leaves it out, and the editor builds fail if
// an eSpeak NG marker shows up in their output (scripts/build-dsh.ts and
// scripts/build-ai-video-editor-host.ts). Their voice preview cards are left
// out of the bundle too (packages/video-editor-bridge/vite.config.mjs).
//
// - Kokoro English voices (kokoro-js): kokoro-js phonemizes with `phonemizer`,
//   which bundles eSpeak NG compiled to WASM. English text gets a clear
//   "not available in this build" message instead.
// - Piper voices other than the built-in pinyin ones (German, Spanish, French,
//   Italian, Portuguese through @diffusionstudio/vits-web): they phonemize with
//   piper-phonemize, eSpeak NG compiled to WASM, whose loader ships in the
//   bundle. No voice card offers them. The Chinese Piper voices (XiaoYa,
//   Chaowen) use their own pinyin front end and are not affected.
export const KOKORO_VOICES_ENABLED = false;
export const ESPEAK_PIPER_VOICES_ENABLED = false;
