/**
 * Shared constants for diff viewer components (sidebar, file sections).
 */
import { palette } from "../../theme";
import type { DiffFileInfo } from "../../types";

export const DIFF_STATUS_COLORS: Record<DiffFileInfo["status"], string> = {
  modified: palette.yellow,
  added: palette.green,
  deleted: palette.red,
  renamed: palette.purple,
  untracked: palette.text2,
};

export const DIFF_STATUS_LABELS: Record<DiffFileInfo["status"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};
