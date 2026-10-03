import { describe, expect, it, vi } from 'vitest';

import {
  VIDEO_EDITOR_CAPABILITIES,
  VideoEditorHostError,
  createVideoEditorMountManager,
  isVideoEditorCapabilityId,
  validateVideoEditorCommandRequest,
  type VideoEditorHostEvent,
  type VideoEditorHostOptions,
} from '../src/index.js';

function options(onEvent: (event: VideoEditorHostEvent) => void = () => {}): VideoEditorHostOptions {
  return {
    hostId: 'film-editor',
    locale: 'zh-CN',
    theme: { '--od-accent': '#6d5dfc' },
    document: {
      schemaVersion: 1,
      projectId: 'project-1',
      productionId: 'production-1',
      compositeId: 'composite-1',
      revision: 3,
      documentVersionId: 'version-3',
      upstreamDocument: { format: 'timeline-studio-archive', version: 3 },
      assets: [],
    },
    onEvent,
  };
}

describe('video editor host contract', () => {
  it('exposes the pinned VibeDev capability vocabulary without accepting arbitrary tools', () => {
    expect(VIDEO_EDITOR_CAPABILITIES).toEqual([
      'caption-font',
      'transcribe',
      'tts',
      'music',
      'repair',
      'restoration',
      'segmentation',
      'depth',
      'avatar',
      'face-swap',
      'auto-edit',
      'vocal-separation',
      'voice-conversion',
      'audio-extraction',
      'optical-flow',
    ]);
    expect(isVideoEditorCapabilityId('music')).toBe(true);
    expect(isVideoEditorCapabilityId('auto-edit')).toBe(true);
    expect(isVideoEditorCapabilityId('shell')).toBe(false);
  });

  it('allows one live mount per container and makes unmount idempotent', () => {
    const implementationUnmount = vi.fn();
    const mountImplementation = vi.fn(() => ({ unmount: implementationUnmount }));
    const manager = createVideoEditorMountManager(mountImplementation);
    const container = {} as HTMLElement;

    const mounted = manager.mount(container, options());

    expect(() => manager.mount(container, options())).toThrowError(
      expect.objectContaining({ code: 'EDITOR_ALREADY_MOUNTED' }),
    );
    mounted.unmount();
    mounted.unmount();
    expect(implementationUnmount).toHaveBeenCalledTimes(1);

    manager.mount(container, options()).unmount();
    expect(mountImplementation).toHaveBeenCalledTimes(2);
  });

  it('delivers host events without changing their structured payload', () => {
    const received: VideoEditorHostEvent[] = [];
    const manager = createVideoEditorMountManager((_container, hostOptions) => {
      hostOptions.onEvent({ type: 'ready', revision: hostOptions.document.revision });
      hostOptions.onEvent({
        type: 'command-request',
        request: {
          schemaVersion: 1,
          operationId: 'operation-1',
          baseRevision: 3,
          command: { type: 'visual.split', clipId: 'clip-1', at: 2 },
        },
      });
      return { unmount() {} };
    });

    manager.mount({} as HTMLElement, options((event) => received.push(event)));

    expect(received).toEqual([
      { type: 'ready', revision: 3 },
      {
        type: 'command-request',
        request: {
          schemaVersion: 1,
          operationId: 'operation-1',
          baseRevision: 3,
          command: { type: 'visual.split', clipId: 'clip-1', at: 2 },
        },
      },
    ]);
  });

  it('accepts a versioned command for the current document revision', () => {
    expect(validateVideoEditorCommandRequest({
      schemaVersion: 1,
      operationId: 'operation-1',
      baseRevision: 3,
      command: { type: 'visual.trim', clipId: 'clip-1', sourceIn: 0, sourceOut: 3 },
    }, 3)).toEqual({
      schemaVersion: 1,
      operationId: 'operation-1',
      baseRevision: 3,
      command: { type: 'visual.trim', clipId: 'clip-1', sourceIn: 0, sourceOut: 3 },
    });
  });

  it.each([
    [{ schemaVersion: 2, operationId: 'op', baseRevision: 3, command: {} }, 'EDITOR_COMMAND_SCHEMA_UNSUPPORTED'],
    [{ schemaVersion: 1, operationId: '', baseRevision: 3, command: {} }, 'EDITOR_OPERATION_ID_REQUIRED'],
    [{ schemaVersion: 1, operationId: 'op', baseRevision: 2, command: {} }, 'EDITOR_REVISION_CONFLICT'],
    [{ schemaVersion: 1, operationId: 'op', baseRevision: 3, command: [] }, 'EDITOR_COMMAND_INVALID'],
  ])('rejects an invalid or stale command (%s)', (request, code) => {
    expect(() => validateVideoEditorCommandRequest(request, 3)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it('uses a stable typed host error', () => {
    const error = new VideoEditorHostError('EDITOR_BUNDLE_INVALID', 'missing mount export');
    expect(error).toMatchObject({
      name: 'VideoEditorHostError',
      code: 'EDITOR_BUNDLE_INVALID',
      message: 'missing mount export',
    });
  });
});
