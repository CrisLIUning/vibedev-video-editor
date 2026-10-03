# Browser object-outline models

Production downloads are mirrored from `haixin/timeline-studio-onnx-models`
on Hugging Face and `martindelophy/timeline-studio-onnx-models` on ModelScope,
pinned to revision `f1005093a90dec7a23746518f9623ee6aaba9cdc`. The application
does not ship duplicate model binaries in this directory.

## NanoDet-Plus-m-320

- Upstream: https://github.com/RangiLyu/nanodet
- Remote path: `object-outline/nanodet-plus-m_320.onnx`
- Upstream release asset: `nanodet-plus-m_320.onnx` from `v1.0.0-alpha-1`
- License: Apache-2.0
- SHA-256: `4f12723cce3d48e47ca92cb925ba74d97a965c069208edca660bbb9f7ce2c610`
- Purpose: COCO object proposals. The browser decoder follows the upstream
  320px BGR normalization, four feature strides, distribution focal loss
  projection, and class-aware NMS.

## MediaPipe MagicTouch 512

- Upstream: https://developers.google.com/edge/mediapipe/solutions/vision/interactive_segmenter
- Remote path: `object-outline/magic_touch_512.tflite`
- Upstream model asset: `ptm_512_hdt_ptm_woid.tflite`
- License: Apache-2.0
- SHA-256: `2baa1c9783d03dd26f91e3c49efbcab11dd1361ff80e40e7209e81f84f281b6a`
- Purpose: point-prompted fast object alpha. SlimSAM remains lazy and is
  requested only when the MagicTouch mask fails the conservative object gate.

Apache-2.0 license text: https://www.apache.org/licenses/LICENSE-2.0
