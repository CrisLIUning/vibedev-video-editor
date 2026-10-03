export type VideoEditorCommandAvailability = 'native' | 'ui-fallback';

export interface VideoEditorCommandDescriptor {
  type: string;
  availability: VideoEditorCommandAvailability;
  destructive: boolean;
  summary: string;
}

const nativeCommands = [
  ['asset.place_version', true, 'Place a VibeDev AssetVersion'],
  ['asset.import', true, 'Import a prepared archive asset'],
  ['timed.move', true, 'Move a timed clip'],
  ['timed.resize', true, 'Resize a timed clip'],
  ['visual.trim', true, 'Trim or restore a video source range at its existing speed; sourceIn/sourceOut are source-media seconds. Restoration requires known source bounds; curves/reverse/freeze cannot be extended.'],
  ['visual.split', true, 'Split a visual clip'],
  ['visual.reorder', true, 'Reorder the visual sequence'],
  ['visual.append', true, 'Append a visual clip'],
  ['visual.insert', true, 'Insert a visual clip'],
  ['overlay.add', true, 'Add a visual overlay'],
  ['transition.set', true, 'Set a transition'],
  ['caption.add', true, 'Add a caption'],
  ['caption.replace_ranges', true, 'Apply reviewed original-audio captions only in specified ranges'],
  ['caption.update', true, 'Update a caption'],
  ['caption.unlink_audio', true, 'Detach a caption from voiceover'],
  ['caption.link_audio', true, 'Attach a caption to voiceover'],
  ['clip.delete', true, 'Delete a clip'],
  ['clip.set_property', true, 'Set a numeric clip property'],
  ['clip.set_speed', true, 'Set clip playback speed'],
  ['clip.set_muted', true, 'Mute or unmute a clip'],
  ['track.set_visibility', true, 'Show or hide a track'],
  ['track.set_locked', true, 'Lock or unlock a track'],
  ['project.set_ratio', true, 'Set the project aspect ratio'],
  ['color.set', true, 'Set or merge a clip colour grade (temperature, tint, saturation, four wheels)'],
  ['filter.set', true, 'Set the rendered filter of a clip, or the project default'],
  ['effect.apply', true, 'Apply an allowlisted versioned effect'],
  ['effect.remove', true, 'Remove an effect from a clip'],
  ['sticker.add', true, 'Add an owned Sticker AssetVersion'],
  ['sticker.update', true, 'Update Sticker timing and transform'],
  ['sticker.remove', true, 'Remove a Sticker'],
  ['music.automation.set', true, 'Set BGM gain envelope and speech ducking'],
  ['audio.set_loudness', true, 'Set the loudness the render normalises to (LUFS)'],
  ['subject.effect.set', true, 'Configure a person or object effect from pinned analysis'],
  ['depth.effect.set', true, 'Configure cinematic depth from pinned analysis'],
  ['parallax.set', true, 'Configure photo parallax from pinned analysis'],
] as const;

// These editor capabilities are intentionally visible to callers. Until the
// upstream command engine exposes reducers for them, the host can use the
// workbench UI as a compatibility fallback instead of pretending they worked.
const uiFallbackCommands = [
  ['keyframe.add', 'Add or update a keyframe'],
  ['keyframe.delete', 'Delete a keyframe'],
  ['effect.set', 'Set a visual effect'],
] as const;

const commands: readonly VideoEditorCommandDescriptor[] = Object.freeze([
  ...nativeCommands.map(([type, destructive, summary]) => ({
    type,
    availability: 'native' as const,
    destructive,
    summary,
  })),
  ...uiFallbackCommands.map(([type, summary]) => ({
    type,
    availability: 'ui-fallback' as const,
    destructive: true,
    summary,
  })),
]);

const commandByType = new Map(commands.map((command) => [command.type, command]));

export function listVideoEditorCommands(): readonly VideoEditorCommandDescriptor[] {
  return commands;
}

export function getVideoEditorCommand(type: string): VideoEditorCommandDescriptor | undefined {
  return commandByType.get(type);
}
