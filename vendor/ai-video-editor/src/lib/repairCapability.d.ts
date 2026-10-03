import type {
  VideoEditorAssetKind,
  VideoEditorCapabilityRuntime,
} from '../../../../packages/video-editor-bridge/src/host-contract.js';
import type { RestorationCapabilitySession } from './restorationCapability.js';

export function startRepairCapability(options: {
  capabilityRuntime?: VideoEditorCapabilityRuntime;
  outputKind: Exclude<VideoEditorAssetKind, 'audio' | 'font'>;
  title: string;
  signal?: AbortSignal;
}): Promise<RestorationCapabilitySession | null>;
