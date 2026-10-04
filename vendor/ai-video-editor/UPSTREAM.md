# Vendored ai-video-editor

This directory contains a reviewed source snapshot of:

- Repository: `https://github.com/MartinDelophy/ai-video-editor.git`
- Commit: `d4aa5d782b41d23b14536413a2b7530d4d53dff3`
- License: MIT; see `LICENSE`
- Model/runtime notices: see `MODEL_LICENSES.md`

The snapshot is maintained by `scripts/sync-ai-video-editor.ts` and described by `vendor/ai-video-editor.manifest.json`. To compare it with the reviewed local source:

```powershell
node --import tsx scripts/sync-ai-video-editor.ts `
  --source '.tmp/upstream/ai-video-editor' `
  --check
```

Since 2026-10-04 this snapshot lives in the `vibedev-video-editor` repository (split out of VibeDev Studio). FFmpeg.wasm (`@ffmpeg/core`, GPL-2.0-or-later) is no longer shipped: the five conversions that used it run on mediabunny and WebCodecs (`src/lib/mediaTranscode.js`). Other runtime WASM ships with the bundle. Downloaded AI model weights under `public/models` are excluded and are fetched on demand. Face swap and AI music are hidden behind `src/config/vibedevFeatures.js` until their model licences are settled. The Kokoro English voices and the eSpeak-based Piper voices (German, Spanish, French, Italian, Portuguese) are switched off there too, and left out of the bundle rather than only hidden: `kokoro-js` (through `phonemizer`) and `@diffusionstudio/vits-web` (through piper-phonemize) carry eSpeak NG, which is GPL-3.0-or-later. With the flags off their imports are unreachable, and `scripts/build-dsh.ts` and `scripts/build-ai-video-editor-host.ts` fail if an eSpeak NG marker reaches the output. The Chinese voices (Hojo, and Piper XiaoYa and Chaowen with their own pinyin front end) are unaffected.

Do not add VibeDev project, Agent, task, theme, or render integration directly to this directory. Those changes belong in the bridge and host layers so future upstream commits remain reviewable. `UPSTREAM.md` is the only VibeDev-owned file preserved inside this directory by the sync utility.
