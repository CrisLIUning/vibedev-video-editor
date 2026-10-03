const INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;

export function timelineProjectFileName(projectName) {
  const stem = String(projectName || "")
    .trim()
    .replace(INVALID_FILENAME_CHARACTERS, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
  return `${stem || "VibeDev-影视工程"}.timeline`;
}
