import {whisperOrtAliases} from './build/whisper-ort-alias';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve:{alias:whisperOrtAliases(path.resolve(import.meta.dirname,"../../vendor/ai-video-editor"))},
  root: import.meta.dirname,
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
