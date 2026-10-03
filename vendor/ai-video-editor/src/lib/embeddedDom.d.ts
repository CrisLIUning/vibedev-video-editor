export function resolveEditorQueryRoot(anchor?: Element | null): Document | ShadowRoot;
export function queryEditorSelector(anchor: Element | null | undefined, selector: string): Element | null;
export function queryEditorSelectorAll(anchor: Element | null | undefined, selector: string): NodeListOf<Element>;
export function resolveEditorElementFromPoint(anchor: Element | null | undefined, clientX: number, clientY: number): Element | null;
export function resolveEditorViewport(anchor?: Element | null): { left: number; top: number; width: number; height: number };
export function editorViewportMatches(anchor?: Element | null, bounds?: { minWidth?: number; maxWidth?: number }): boolean;
export function editorEventPathContains(event: Pick<Event, 'target' | 'composedPath'>, selector: string): boolean;
