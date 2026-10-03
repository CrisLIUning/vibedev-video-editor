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
