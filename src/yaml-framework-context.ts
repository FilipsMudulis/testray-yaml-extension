import * as vscode from "vscode";

export const GHERKIN_KEYS = ["Given", "Then", "And", "But", "When"];

export const ROOT_NON_CASE_KEYS = new Set([
  "Apps",
  "Devices",
  "Environments",
  "Timeout",
  "chromeDriverPath",
]);

export type SemanticRenameKind = "case" | "step" | "environment" | "role" | "generic";

export function normalizeFrameworkValue(text: string): string {
  return text.replace(/^['"]|['"]$/g, "").replace(/:$/, "").trim();
}

export function getCurrentKeyFromLinePrefix(linePrefix: string): string | undefined {
  const trimmed = linePrefix.trimStart();
  const keyMatch = trimmed.match(/^-?\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
  return keyMatch?.[1];
}

export function getListParentKey(
  document: vscode.TextDocument,
  position: vscode.Position
): string | undefined {
  const current = document.lineAt(position).text.slice(0, position.character).trimStart();
  if (!current.startsWith("-")) {
    return undefined;
  }

  const currentIndent = document.lineAt(position).firstNonWhitespaceCharacterIndex;
  for (let line = position.line - 1; line >= 0; line -= 1) {
    const text = document.lineAt(line).text;
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const indent = document.lineAt(line).firstNonWhitespaceCharacterIndex;
    if (indent < currentIndent) {
      const keyMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*$/);
      return keyMatch?.[1];
    }
  }

  return undefined;
}

export function isCaseValueContext(
  document: vscode.TextDocument,
  position: vscode.Position
): boolean {
  for (let line = position.line; line >= 0; line -= 1) {
    const text = document.lineAt(line).text;
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    if (/^-/.test(trimmed) && line !== position.line) {
      return false;
    }

    const typeMatch = trimmed.match(/^Type\s*:\s*(.+)$/);
    if (typeMatch) {
      return normalizeFrameworkValue(typeMatch[1]) === "case";
    }
  }
  return false;
}

function isEnvironmentDefinitionCursor(
  document: vscode.TextDocument,
  position: vscode.Position
): boolean {
  const line = document.lineAt(position.line).text;
  const trimmed = line.trim();
  const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
  if (!match) {
    return false;
  }
  const indent = line.length - line.trimStart().length;
  const nameStart = line.indexOf(match[1]);
  const nameEnd = nameStart + match[1].length;
  if (position.character < nameStart || position.character > nameEnd) {
    return false;
  }

  let foundEnvironments = false;
  let envIndent = 0;
  for (let i = position.line; i >= 0; i -= 1) {
    const l = document.lineAt(i).text;
    const t = l.trim();
    if (t.length === 0 || t.startsWith("#")) {
      continue;
    }
    const ind = l.length - l.trimStart().length;
    if (/^Environments\s*:\s*$/.test(t)) {
      foundEnvironments = true;
      envIndent = ind;
      break;
    }
    if (i < position.line && ind < indent) {
      return false;
    }
  }
  if (!foundEnvironments) {
    return false;
  }
  return indent > envIndent;
}

export function detectSemanticRenameKind(
  document: vscode.TextDocument,
  position: vscode.Position
): SemanticRenameKind {
  const line = document.lineAt(position.line).text;
  const indent = line.length - line.trimStart().length;
  const trimmed = line.trim();

  const linePrefix = line.slice(0, position.character);
  const currentKey = getCurrentKeyFromLinePrefix(linePrefix);
  const listParentKey = getListParentKey(document, position);

  const topMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
  if (indent === 0 && topMatch && !ROOT_NON_CASE_KEYS.has(topMatch[1])) {
    const nameStart = line.indexOf(topMatch[1]);
    const nameEnd = nameStart + topMatch[1].length;
    if (position.character >= nameStart && position.character <= nameEnd) {
      return "case";
    }
  }

  if (/^\s*Step\s*:\s*/.test(line)) {
    const colonIdx = line.indexOf(":");
    if (position.character > colonIdx) {
      return "step";
    }
  }

  if (isEnvironmentDefinitionCursor(document, position)) {
    return "environment";
  }

  if (
    (currentKey === "Value" && isCaseValueContext(document, position)) ||
    currentKey === "Case" ||
    listParentKey === "Precases" ||
    listParentKey === "Aftercases"
  ) {
    return "case";
  }
  if (currentKey && GHERKIN_KEYS.includes(currentKey)) {
    return "step";
  }
  if (currentKey === "Environment" || listParentKey === "Inherit") {
    return "environment";
  }
  if (currentKey === "Role") {
    return "role";
  }
  return "generic";
}

export function previousActionTypeIsCase(
  lines: FileContentLine[],
  lineIndex: number,
  currentIndent: number
): boolean {
  for (let i = lineIndex - 1; i >= 0; i -= 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent < currentIndent) {
      return false;
    }
    if (indent === currentIndent && /^Type\s*:\s*(.+)$/.test(trimmed)) {
      const match = trimmed.match(/^Type\s*:\s*(.+)$/);
      return match ? normalizeFrameworkValue(match[1]) === "case" : false;
    }
    if (indent === currentIndent && /^-\s/.test(trimmed)) {
      return false;
    }
  }
  return false;
}

export function getParentCollectionKey(
  lines: FileContentLine[],
  lineIndex: number,
  currentIndent: number
): string | undefined {
  for (let i = lineIndex - 1; i >= 0; i -= 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent < currentIndent) {
      const keyMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*$/);
      return keyMatch?.[1];
    }
  }
  return undefined;
}

export function isUnderCasesCollection(
  lines: FileContentLine[],
  lineIndex: number,
  currentIndent: number
): boolean {
  return getParentCollectionKey(lines, lineIndex, currentIndent) === "Cases";
}
