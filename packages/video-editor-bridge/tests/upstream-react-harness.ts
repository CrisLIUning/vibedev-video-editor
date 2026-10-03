import { createRequire } from 'node:module';
import path from 'node:path';

// Exercise the same React copy as the vendored editor, without adding a second
// React runtime to the otherwise framework-neutral bridge package.
const requireVendor = createRequire(path.resolve(import.meta.dirname, '../../../vendor/ai-video-editor/package.json'));
export const React = requireVendor('react');
export const { createRoot } = requireVendor('react-dom/client');

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
