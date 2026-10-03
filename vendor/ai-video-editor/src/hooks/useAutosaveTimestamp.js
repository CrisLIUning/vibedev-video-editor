import { useEffect, useState } from "react";
import { formatSavedTime } from "../lib/timeline.js";

export function nextAutosaveState(previous, date = new Date()) {
  return {
    label: formatSavedTime(date),
    revision: (Number(previous?.revision) || 0) + 1,
  };
}

export function useAutosaveTimestamp(values, delay = 450) {
  const [autosave, setAutosave] = useState(() => ({ label: formatSavedTime(), revision: 0 }));
  useEffect(() => {
    const timer = window.setTimeout(() => setAutosave((current) => nextAutosaveState(current)), delay);
    return () => window.clearTimeout(timer);
  }, [...values, delay]);
  return autosave;
}
