export interface AutosaveState { label: string; revision: number }
export function nextAutosaveState(previous: AutosaveState, date?: Date): AutosaveState;
export function useAutosaveTimestamp(values: readonly unknown[], delay?: number): AutosaveState;
