// MediaPipe's FilesetResolver.forVisionTasks(root, useModule = false) loads
// vision_wasm_internal (or the no-SIMD build), and vision_wasm_module_internal
// only when useModule is passed. The file name is assembled at run time, so no
// output file names it and the unreferenced-wasm pass cannot see the choice:
// the build drops the module build only after reading every call site.
const FOR_VISION_TASKS = /\.forVisionTasks\(([^()]*)\)/g;

/** Returns the number of classic call sites; throws when one asks for the module build or none is found. */
export function assertClassicMediaPipeLoader(outputTexts: string[]): number {
  let calls = 0;
  for (const text of outputTexts) {
    for (const match of text.matchAll(FOR_VISION_TASKS)) {
      if (match[1]!.includes(',')) {
        throw new Error(`the editor asks for the MediaPipe module build (${match[0]}); ship vision_wasm_module_internal again`);
      }
      calls += 1;
    }
  }
  if (calls === 0) {
    throw new Error('the editor build found no MediaPipe loader (forVisionTasks); check how it loads MediaPipe before dropping the module build');
  }
  return calls;
}
