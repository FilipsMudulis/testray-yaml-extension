import { FilesContentMap } from "./get-files-content-map";
import { normalizeFrameworkValue } from "../yaml-framework-context";

export const CLI_VAR_FULL_PATTERN = /^\$AND_CLI_([A-Za-z0-9_]+)\$$/;
export const MAINROLE_CLI_TOKEN = "$AND_CLI_MAINROLE$";
export const CLI_TOKEN_REGEX_GLOBAL = /\$AND_CLI_([A-Za-z0-9_]+)\$/g;

export function isInsideVarsSection(lines: FileContentLine[], lineIndex: number): boolean {
  const currentLine = lines[lineIndex] ?? "";
  const currentIndent = currentLine.length - currentLine.trimStart().length;
  for (let i = lineIndex - 1; i >= 0; i -= 1) {
    const candidate = lines[i] ?? "";
    const trimmed = candidate.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const indent = candidate.length - candidate.trimStart().length;
    if (indent < currentIndent) {
      return /^Vars\s*:\s*$/.test(trimmed);
    }
  }
  return false;
}

export function isInsideGrepsSection(lines: FileContentLine[], lineIndex: number): boolean {
  const startLine = lines[lineIndex] ?? "";
  let targetIndent = startLine.length - startLine.trimStart().length;

  for (let i = lineIndex - 1; i >= 0; i -= 1) {
    const candidate = lines[i] ?? "";
    const trimmed = candidate.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const indent = candidate.length - candidate.trimStart().length;
    if (indent >= targetIndent) {
      continue;
    }
    if (/^Greps\s*:\s*$/.test(trimmed)) {
      return true;
    }
    if (/^-\s*var\s*:/.test(trimmed)) {
      targetIndent = indent;
      continue;
    }
    targetIndent = indent;
  }
  return false;
}

export type WorkspaceCliVarIndex = {
  /** Var name → literal values seen under `Vars:` (may be multiple files). */
  varsValues: Map<string, Set<string>>;
  /** Names assigned via `Greps` → `- var:` (runtime / scraped). */
  grepVarNames: Set<string>;
};

export function collectWorkspaceCliVarDefinitions(filesContentMap: FilesContentMap): WorkspaceCliVarIndex {
  const varsValues = new Map<string, Set<string>>();
  const grepVarNames = new Set<string>();

  Object.values(filesContentMap).forEach((lines) => {
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return;
      }

      const varDef = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
      if (varDef && isInsideVarsSection(lines, index)) {
        const [, key, valueRaw] = varDef;
        const existing = varsValues.get(key) ?? new Set<string>();
        normalizeFrameworkValue(valueRaw)
          .split(",")
          .map((part) => normalizeFrameworkValue(part))
          .filter(Boolean)
          .forEach((part) => existing.add(part));
        varsValues.set(key, existing);
      }

      const grepVar = trimmed.match(/^-\s*var\s*:\s*(.+)$/);
      if (grepVar && isInsideGrepsSection(lines, index)) {
        normalizeFrameworkValue(grepVar[1])
          .split(",")
          .map((part) => normalizeFrameworkValue(part))
          .filter(Boolean)
          .forEach((name) => grepVarNames.add(name));
      }
    });
  });

  return { varsValues, grepVarNames };
}

export function getCliVarNameFromFullToken(token: string): string | undefined {
  const m = token.match(CLI_VAR_FULL_PATTERN);
  return m?.[1];
}

export function sortedCliVarNameSuggestions(
  varsValues: Map<string, Set<string>>,
  grepVarNames: Set<string>,
  namePrefix: string
): string[] {
  const names = new Set<string>();
  varsValues.forEach((_v, k) => names.add(k));
  grepVarNames.forEach((k) => names.add(k));
  return [...names]
    .filter((n) => namePrefix === "" || n.startsWith(namePrefix))
    .sort((a, b) => a.localeCompare(b));
}

/** If the cursor is completing after `$AND_CLI_`, returns the partial name and column where `$` starts. */
export function parseAndCliCompletionPrefix(linePrefix: string): { partial: string; replaceStart: number } | undefined {
  const m = linePrefix.match(/\$AND_CLI_([A-Za-z0-9_]*)$/);
  if (!m) {
    return undefined;
  }
  return { partial: m[1], replaceStart: linePrefix.length - m[0].length };
}

export type CliTokenAtPosition = {
  fullToken: string;
  varName: string;
  start: number;
  end: number;
};

export function findCliTokenAtColumn(line: string, column: number): CliTokenAtPosition | undefined {
  CLI_TOKEN_REGEX_GLOBAL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLI_TOKEN_REGEX_GLOBAL.exec(line)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (column >= start && column < end) {
      return { fullToken: m[0], varName: m[1], start, end };
    }
  }
  return undefined;
}
