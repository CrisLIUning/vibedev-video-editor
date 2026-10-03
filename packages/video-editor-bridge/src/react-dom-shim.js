import ReactDOM from '../../../vendor/ai-video-editor/node_modules/react-dom/index.js';

import { resolveEmbeddedEditorPortalTarget } from './editor-host-environment.ts';

export const flushSync = ReactDOM.flushSync;
export function createPortal(children, container, key) {
  return ReactDOM.createPortal(children, resolveEmbeddedEditorPortalTarget(container), key);
}
export default ReactDOM;
