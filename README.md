# vibedev-video-editor · VibeDev 剪辑台

VibeDev 的剪辑台：浏览器里运行的时间线编辑器，带 AI 配音、字幕、修复等能力。它是开源编辑器 [ai-video-editor](https://github.com/MartinDelophy/ai-video-editor)（MIT）的 VibeDev 分支，加上把它嵌进宿主的桥接层。VibeDev Studio 和 DeepSeek Harness 的影视插件 [dsh-film](https://github.com/CrisLIUning/dsh-film) 都用它。

The VibeDev editing desk: a browser timeline editor with AI voice, captions and repair, forked from [ai-video-editor](https://github.com/MartinDelophy/ai-video-editor) (MIT), plus the bridge that embeds it in a host. VibeDev Studio and the DeepSeek Harness film plugin [dsh-film](https://github.com/CrisLIUning/dsh-film) use it.

## 目录 · Layout

```
vendor/ai-video-editor/          编辑器本体（上游快照 + VibeDev 的改动，改动处标 FORK:）
vendor/ai-video-editor.manifest.json   上游来源和打包策略
packages/video-editor-bridge/    桥接：mountVideoEditor、Shadow DOM 外壳、宿主协议、时间线命令引擎
dsh/                             DeepSeek Harness 宿主页（dsh-film 的剪辑台标签里加载）
scripts/                         构建脚本
```

## 构建 · Build

```bash
npm install          # 根目录：桥接和宿主页的开发依赖
npm run setup        # 编辑器本体的依赖（vendor/ai-video-editor）
npm run build        # Studio 用：桥接合约 + 编辑器（/video-editor/ 下）
npm run build:dsh    # dsh-film 用：编辑器 + 宿主页 → dist-dsh/（/api/dsh-film/apps/editor/ 下）
npm test
npm run typecheck
```

dsh-film 的 `node scripts/build-apps.mjs editor` 会调用 `build:dsh`，把 `dist-dsh/` 放进插件的 `apps/editor/`，并把桥接合约（时间线命令引擎）拷成插件的 `vendor/video-editor-bridge.mjs`。

`dist-dsh/` 里有两张页面：宿主页（`index.html` + `host.js`）和字幕识别页（`caption-runner.html` + `caption-runner.js`）。识别页由 dsh-film 在 DSH 窗口里隐藏打开，一次跑一个识别任务：领取任务，用同一个编辑器包里的 `transcribeTimelineSources` 在本机跑 Whisper（small q8，Silero 检测人声），回报进度和结果（`dsh/src/caption-runner.ts`）。字幕只用本机 Whisper 识别，音频不离开本机。宿主页的 CC 按钮只提交后台识别：还没同意下载的识别模型先问，保存好再提交，草稿在右下角的面板里打开校对，逐句试听原声、可排除，先试写再写入（`dsh/src/captions.ts`）。导出面板的「渲染到项目」由 dsh-film 用本机 ffmpeg 渲染，没有 ffmpeg 时先问再下载（`dsh/src/session.ts`）。

## 和上游的区别 · Differences from upstream

- **不带 FFmpeg.wasm**：`@ffmpeg/core` 是 GPL-2.0-or-later。编辑器的五处转码（取视频原声、音频转 WAV、WebM 转 MP4、不兼容视频转可编辑格式、逐帧编码）改用 mediabunny（MPL-2.0）和浏览器自带的 WebCodecs，见 `vendor/ai-video-editor/src/lib/mediaTranscode.js`。浏览器解不了的编码（MPEG-2、VC-1 等）因此不再能转。
- **两个功能先关掉**（`src/config/vibedevFeatures.js`）：换脸（模型依赖 InsightFace，只许非商业研究）、AI 配乐（Stable Audio，许可条款待定）。
- 嵌入宿主所需的改动：语言、弹层、地址前缀、宿主保存导出、主机项目画幅等，均标 `FORK:`。

模型权重不在包里，用到时从 VibeDev 的镜像或模型原站下载；各模型的许可见 `vendor/ai-video-editor/MODEL_LICENSES.md`。在 DeepSeek Harness 里，宿主页实现了 `prepareModel` / `ensureModelConsent`（`dsh/src/models.ts`）：第一次用到某个模型时先弹框说明用途、大小、许可和来源（`dsh/src/consent.ts`），同意后由 dsh-film 下载、校验并从它自己的路由供给，编辑器的 worker 直接取用；拒绝过的字幕字体在本次打开期间不再追问。还没走宿主的：“智能”工具的主体识别（YOLOS-tiny、MODNet）仍由浏览器直接从 VibeDev 镜像下载。

## License

VibeDev 的代码（桥接、宿主页、脚本、编辑器里标 FORK 的改动）用 MIT，见 `LICENSE`。编辑器本体上游部分 MIT，版权归原作者，见 `vendor/ai-video-editor/LICENSE`。依赖各有许可（mediabunny MPL-2.0 等）。
