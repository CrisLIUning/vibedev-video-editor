# Model, Dataset, and Media License Notice

## 中文说明

本仓库根目录的 [MIT License](LICENSE) 仅适用于 Timeline Studio 的原创源代码和原创文档，文件或目录另有许可声明的除外。

本仓库的 MIT License **不自动适用于**第三方模型、模型权重、数据集、字体、图库媒体、示例素材或其他随仓库提供及运行时远程下载的资源。无论这些资源存放在哪里，也无论项目通过下载脚本、浏览器缓存、服务工作线程、Hugging Face、ModelScope、其他镜像或自定义地址使用它们，均应继续遵守各自的上游许可证和使用条款。

模型转换为 ONNX、切分、量化、重新打包、固定版本、记录校验和或集成到 Timeline Studio，均不代表项目取得或授予该模型的新许可。重新分发、部署、发表生成内容或商业使用前，使用者必须核验对应上游项目、具体模型权重、训练数据和媒体资源的适用条款。上游许可缺失、含糊或彼此冲突时，在权利人确认前应视为尚未获得相关使用授权。

尤其是换脸功能使用的 MobileFaceSwap、ArcFace 相关身份权重与 SCRFD 检测权重，当前按研究模型处理。本仓库的 MIT License 不授予这些权重的商业使用权；商业发布或重新分发前必须另行核验并取得所需权利。

本文件仅提供许可证边界和归属信息，不构成法律意见。下方英文部分列出了当前模型类别和维护要求。

## Scope

The repository-level [MIT License](LICENSE) applies only to Timeline Studio's
original source code and documentation unless a file or directory states a
different license.

It does **not** automatically apply to third-party models, model weights,
datasets, fonts, stock media, sample media, or other bundled or remotely
downloaded assets. Those materials remain subject to their respective upstream
licenses and terms, regardless of:

- where the files are hosted;
- whether they are downloaded from Hugging Face, ModelScope, another mirror, or
  a user-configured URL;
- whether they are cached by the browser or a service worker;
- whether they are converted, split, quantized, repackaged, or integrated into
  Timeline Studio; or
- whether a download script, URL, checksum, or runtime adapter is included in
  this repository.

Repository availability is not a grant of rights to any third-party artifact.
Before redistribution, deployment, publication, or commercial use, users must
review the license and acceptable-use terms for every applicable upstream
project and model release. If the upstream terms are missing, ambiguous, or
inconsistent, treat the artifact as not cleared for that use until the rights
holder confirms otherwise.

This notice is informational and is not legal advice.

## Face swap models

Timeline Studio's browser face-swap workflow loads the following artifacts from
the `mobilefaceswap-224/` directory of the Timeline Studio ONNX model mirrors.
The configured files are pinned to immutable repository revisions and include
expected byte sizes and SHA-256 digests in
[`src/config/faceSwap.js`](src/config/faceSwap.js).

| Artifact | Purpose | Upstream/derivation | License status in this project |
| --- | --- | --- | --- |
| `mobilefaceswap_identity.onnx` | Source identity extraction | MobileFaceSwap / ArcFace-related research weights | Research weights; commercial rights are not granted or confirmed by the repository MIT License |
| `mobilefaceswap_conditioner.onnx` | Source-specific generator conditioning | MobileFaceSwap research weights | Research weights; verify upstream rights before every redistribution or commercial release |
| `mobilefaceswap_generator.onnx` | Per-frame 224px face generation | MobileFaceSwap research weights | Research weights; verify upstream rights before every redistribution or commercial release |
| `scrfd_10g_bnkps.onnx` | Face detection and five-point landmarks | SCRFD checkpoint distributed for the MobileFaceSwap workflow | Model-weight rights must be verified separately |

The face-swap artifacts are mirrored for reproducible browser delivery. Mirroring,
converting to ONNX, pinning a revision, or recording a checksum does not
relicense the weights. The face-swap feature must not be described as cleared
for commercial use solely because Timeline Studio's original code is MIT
licensed.

## Models with license notes stored in this repository

The following artifacts have dedicated local notices. Their directory-specific
license files and upstream notices control:

| Model | Purpose | Recorded license | Local notice |
| --- | --- | --- | --- |
| MI-GAN 256 | Browser image/video repair | MIT | [`public/models/migan-webgpu/README.md`](public/models/migan-webgpu/README.md) and [`LICENSE`](public/models/migan-webgpu/LICENSE) |
| NanoVSR 644K | Browser image/video 4× restoration | MIT | [`public/models/nanovsr-644k/README.md`](public/models/nanovsr-644k/README.md) and [`LICENSE`](public/models/nanovsr-644k/LICENSE) |
| NanoDet-Plus-m-320 | Object proposals | Apache-2.0 | [`public/assets/effects/models/OBJECT_MODELS.md`](public/assets/effects/models/OBJECT_MODELS.md) |
| MediaPipe MagicTouch 512 | Point-prompted object segmentation | Apache-2.0 | [`public/assets/effects/models/OBJECT_MODELS.md`](public/assets/effects/models/OBJECT_MODELS.md) |
| Depth Anything V2 Small Q4F16 | Browser-local relative depth estimation | Apache-2.0 | [`public/assets/effects/models/DEPTH_ANYTHING_V2_SMALL.md`](public/assets/effects/models/DEPTH_ANYTHING_V2_SMALL.md) |

## Other remotely loaded AI models

Timeline Studio can also load additional third-party model families at runtime,
including:

- Stable Audio 3 Small-derived browser music models;
- Kokoro ONNX and Piper/VITS voice models;
- Whisper automatic-speech-recognition models;
- YOLOS, MODNet, SlimSAM, MediaPipe, and other vision models;
- JoyVASA and LivePortrait-derived digital-human models;
- vocal-separation models;
- DRUNet and other restoration models; and
- future models selected through user or deployment configuration.

These model files are not relicensed under Timeline Studio's MIT License. The
authoritative license is the license attached to the exact upstream model,
checkpoint, dataset, or model-card revision that is loaded. A repository name,
runtime label, or model-family license is not sufficient evidence that a
particular checkpoint and its training data are cleared for a proposed use.

Where Timeline Studio source configuration records a license value, that value
is an attribution and implementation note, not an independent license grant.
Users must still review the upstream license, model card, dataset terms, and any
use restrictions for the exact pinned artifact.

## Datasets and training data

Timeline Studio does not grant rights to datasets or training data used by
third-party models. A model codebase and its weights may have different license
terms, and the dataset used to train a model may impose additional conditions.
Users are responsible for confirming that their intended use is permitted by
all applicable licenses, privacy rights, publicity rights, and data terms.

## Fonts, stock media, and user-selected assets

- Downloadable caption fonts remain subject to their recorded font licenses,
  commonly the SIL Open Font License 1.1, or to the system-font terms shown by
  the application.
- Pexels and Openverse catalog results remain subject to the license and
  attribution data returned for each individual asset.
- Built-in samples, previews, icons, textures, and other media may have
  file-specific or upstream terms.
- User-imported media remains the responsibility of the user. Timeline Studio
  does not grant additional rights to edit, redistribute, or publish that
  material.

Do not remove attribution, source URL, creator, or license metadata supplied
with a catalog asset when the applicable license requires it.

## Dependencies and codecs

JavaScript, WebAssembly, codec, and browser-runtime dependencies retain their
own licenses. In particular, the compatibility media runtime includes an
LGPL-2.1-or-later FFmpeg/LibAV configuration documented in
[`src/vendor/libav-timeline-compat/BUILD.md`](src/vendor/libav-timeline-compat/BUILD.md).
The root MIT License does not replace dependency or codec obligations.

## Maintainer checklist

When adding or updating a model or remote asset:

1. Pin the upstream artifact to an immutable revision where possible.
2. Record its upstream project and exact source URL.
3. Record the applicable license and keep a copy when redistribution requires
   it.
4. Record file sizes and SHA-256 digests for production artifacts.
5. Keep code-license and model-weight-license claims separate.
6. Document material commercial-use, redistribution, attribution, data, and
   acceptable-use restrictions.
7. Do not label an artifact as commercially cleared when its rights have not
   been verified.
8. Update this notice and any directory-specific model notes in the same
   change.
