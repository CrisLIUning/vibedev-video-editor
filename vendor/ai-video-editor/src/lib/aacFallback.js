import { registerAacEncoder } from "@mediabunny/aac-encoder";

// FORK: one registration of the AAC encoder for every mediabunny output in the
// editor. Each registration adds another encoder to mediabunny's list, and the
// export and the transcodes both need it.
let registered = false;

export function ensureAacEncoder() {
  if (registered) return;
  registerAacEncoder();
  registered = true;
}
