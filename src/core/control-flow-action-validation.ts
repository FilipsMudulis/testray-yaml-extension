import { normalizeFrameworkValue } from "../yaml-framework-context";

export function findRoleValueInAction(actionLines: string[]): string | undefined {
  for (const line of actionLines) {
    const m = line.trim().match(/^Role\s*:\s*(.+)$/);
    if (m) {
      return normalizeFrameworkValue(m[1]);
    }
  }
  return undefined;
}

export function isTimerRoleValid(role: string | undefined): boolean {
  if (!role) {
    return false;
  }
  const r = role.toLowerCase();
  return r === "start" || r === "end";
}

export function parseLoopCaseName(actionLines: string[]): string | undefined {
  for (const line of actionLines) {
    const m = line.trim().match(/^Case\s*:\s*(.+)$/);
    if (m) {
      return normalizeFrameworkValue(m[1]);
    }
  }
  return undefined;
}

export function parseLoopTimesRaw(actionLines: string[]): string | undefined {
  for (const line of actionLines) {
    const m = line.trim().match(/^Times\s*:\s*(.*)$/);
    if (m) {
      return normalizeFrameworkValue(m[1]);
    }
  }
  return undefined;
}

export function isValidLoopTimesValue(raw: string | undefined): boolean {
  if (raw === undefined || raw === "") {
    return false;
  }
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0;
}

export type IfCasesItemIssue = { itemStartLine: number; message: string };

/**
 * Each list item under `If_Cases` must contain `If_Case` (TestRay raises otherwise).
 * Skips inline `If_Cases: []` and inline bracket forms.
 */
export function validateIfCasesListItems(actionLines: string[], ifCasesLineIndex: number): IfCasesItemIssue[] {
  const issues: IfCasesItemIssue[] = [];
  const baseLine = actionLines[ifCasesLineIndex];
  if (!baseLine) {
    return issues;
  }

  const afterColon = baseLine.replace(/^.*If_Cases\s*:\s*/, "").trim();
  if (afterColon === "[]" || afterColon.startsWith("[")) {
    return issues;
  }

  const baseIndent = baseLine.length - baseLine.trimStart().length;
  let listItemIndent: number | undefined;

  for (let i = ifCasesLineIndex + 1; i < actionLines.length; i += 1) {
    const line = actionLines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const indent = line.length - line.trimStart().length;
    if (indent <= baseIndent) {
      if (/^Else_Case\s*:/.test(trimmed)) {
        break;
      }
      if (!trimmed.startsWith("-")) {
        break;
      }
    }

    if (trimmed.startsWith("-")) {
      if (listItemIndent === undefined) {
        listItemIndent = indent;
      }
      if (indent === listItemIndent) {
        const end = findEndOfIfCasesListItem(actionLines, i, listItemIndent, baseIndent);
        const segment = actionLines.slice(i, end + 1).join("\n");
        if (!/If_Case\s*:/.test(segment)) {
          issues.push({
            itemStartLine: i,
            message:
              "Each `If_Cases` entry must include `If_Case` (TestRay raises if it is missing).",
          });
        }
        i = end;
      }
    }
  }

  return issues;
}

function findEndOfIfCasesListItem(
  lines: string[],
  start: number,
  listItemIndent: number,
  ifCasesBaseIndent: number
): number {
  let end = start;
  for (let j = start + 1; j < lines.length; j += 1) {
    const line = lines[j];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      end = j;
      continue;
    }

    const indent = line.length - line.trimStart().length;
    if (indent <= ifCasesBaseIndent) {
      if (/^Else_Case\s*:/.test(trimmed)) {
        return end;
      }
      return end;
    }

    if (trimmed.startsWith("-") && indent === listItemIndent) {
      return end;
    }

    end = j;
  }
  return end;
}

export function findIfCasesLineIndex(actionLines: string[]): number {
  return actionLines.findIndex((l) => /^\s*If_Cases\s*:/.test(l));
}
