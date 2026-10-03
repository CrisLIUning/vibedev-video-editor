import { startModelMediaCapability } from "./restorationCapability.js";

export function startRepairCapability(options) {
  return startModelMediaCapability({
    ...options,
    capability: "repair",
    modelId: "migan-256-webgpu",
    failureCode: "VIDEO_EDITOR_REPAIR_FAILED",
  });
}
