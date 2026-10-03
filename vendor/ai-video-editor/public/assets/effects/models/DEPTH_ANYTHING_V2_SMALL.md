# Depth Anything V2 Small browser model

Timeline Studio loads the Q4F16 Transformers.js model from owned mirrors:

- Hugging Face: `haixin/timeline-studio-onnx-models`, path
  `depth-anything-v2-small/`, revision
  `a0806c6fb9484894dcb78df523156d244461515d`
- ModelScope: `martindelophy/timeline-studio-onnx-models`, path
  `depth-anything-v2-small/`, revision
  `4cc757f80330e22cb8f82b628c53ceca6307fd12`

Both providers contain the same runtime files and share one browser cache
identity. Chinese and domestic sessions prefer ModelScope; other sessions
prefer Hugging Face, with automatic fallback.

## Upstream and license

- Upstream repository: https://huggingface.co/onnx-community/depth-anything-v2-small
- Upstream immutable revision: `4472b7362082ad9968fee890ca0f1e5aca36b93d`
- Base model: https://huggingface.co/depth-anything/Depth-Anything-V2-Small
- License: Apache-2.0
- Runtime artifact: `onnx/model_q4f16.onnx`
- Size: `19,126,267` bytes
- SHA-256: `eca72971aea64216d767c70c534160de53b5435b588d362bac6dbd5a73f9bf1e`

Each remote mirror also includes the upstream model card, Apache-2.0 license
text, source note, configuration files, and their SHA-256 digests.
