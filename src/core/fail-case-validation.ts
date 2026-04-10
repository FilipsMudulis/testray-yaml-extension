import { normalizeFrameworkValue } from "../yaml-framework-context";

export type FailCaseKeyEntry = { relativeLine: number; valueRaw: string };

export function findFailCaseLineIndex(actionLines: string[]): number {
  return actionLines.findIndex((l) => /^\s*FailCase\s*:/.test(l));
}

export function getFailCaseLineInlineRest(failLine: string): string {
  const m = failLine.match(/^\s*FailCase\s*:\s*(.*)$/);
  return (m?.[1] ?? "").trim();
}

function tryParseInlineFailCaseFlowMap(
  rest: string,
  failCaseLineIndex: number
): Map<string, FailCaseKeyEntry> | undefined {
  const compact = rest.replace(/\s+/g, " ");
  const m = compact.match(
    /^\{\s*Value\s*:\s*([^,}]+?)(?:\s*,\s*ContinueOnFail\s*:\s*([^,}]+?))?\s*\}\s*$/i
  );
  if (!m) {
    return undefined;
  }
  const map = new Map<string, FailCaseKeyEntry>();
  map.set("Value", { relativeLine: failCaseLineIndex, valueRaw: m[1].trim() });
  if (m[2] !== undefined && m[2].trim() !== "") {
    map.set("ContinueOnFail", { relativeLine: failCaseLineIndex, valueRaw: m[2].trim() });
  }
  return map;
}

function parseFailCaseMapChildren(
  actionLines: string[],
  failCaseLineIndex: number,
  failIndent: number
): Map<string, FailCaseKeyEntry> {
  const keys = new Map<string, FailCaseKeyEntry>();
  let minDeeper: number | undefined;

  for (let i = failCaseLineIndex + 1; i < actionLines.length; i += 1) {
    const line = actionLines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent <= failIndent) {
      break;
    }
    if (minDeeper === undefined || indent < minDeeper) {
      minDeeper = indent;
    }
  }

  if (minDeeper === undefined) {
    return keys;
  }

  for (let i = failCaseLineIndex + 1; i < actionLines.length; i += 1) {
    const line = actionLines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent <= failIndent) {
      break;
    }
    if (indent !== minDeeper) {
      continue;
    }
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (m) {
      keys.set(m[1], { relativeLine: i, valueRaw: m[2] });
    }
  }

  return keys;
}

function parseFailCaseListChildren(
  actionLines: string[],
  failCaseLineIndex: number,
  failIndent: number
): Map<string, FailCaseKeyEntry> {
  const keys = new Map<string, FailCaseKeyEntry>();
  for (let i = failCaseLineIndex + 1; i < actionLines.length; i += 1) {
    const line = actionLines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent <= failIndent) {
      break;
    }
    const m = trimmed.match(/^-\s+([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (m) {
      keys.set(m[1], { relativeLine: i, valueRaw: m[2] });
    }
  }
  return keys;
}

/**
 * Reads `Value` and `ContinueOnFail` under `FailCase` (TestRay expects a hash:
 * `action["FailCase"]["Value"]`, `action["FailCase"]["ContinueOnFail"]`).
 * Supports mapping style, README-style list items (`- Value:` / `- ContinueOnFail:`), and simple `{ Value: x, ... }` on the same line.
 */
export function parseFailCaseChildren(
  actionLines: string[],
  failCaseLineIndex: number
): Map<string, FailCaseKeyEntry> {
  const failLine = actionLines[failCaseLineIndex] ?? "";
  if (!/^\s*FailCase\s*:/.test(failLine)) {
    return new Map();
  }

  const inlineRest = getFailCaseLineInlineRest(failLine);
  if (inlineRest && inlineRest !== "|" && inlineRest !== ">") {
    const inlineMap = tryParseInlineFailCaseFlowMap(inlineRest, failCaseLineIndex);
    if (inlineMap) {
      return inlineMap;
    }
    return new Map();
  }

  const failIndent = failLine.length - failLine.trimStart().length;
  const mapKeys = parseFailCaseMapChildren(actionLines, failCaseLineIndex, failIndent);
  if (mapKeys.size > 0) {
    return mapKeys;
  }

  return parseFailCaseListChildren(actionLines, failCaseLineIndex, failIndent);
}

export function isContinueOnFailBooleanLike(raw: string): boolean {
  const t = normalizeFrameworkValue(raw).toLowerCase();
  return t === "true" || t === "false";
}

/** Resolves case name when `Value:` uses a folded/block scalar on following lines. */
export function resolveFailCaseValueName(valueEntry: FailCaseKeyEntry, actionLines: string[]): string {
  const direct = normalizeFrameworkValue(valueEntry.valueRaw);
  if (direct) {
    return direct;
  }

  const valueLine = actionLines[valueEntry.relativeLine] ?? "";
  const keyIndent = valueLine.length - valueLine.trimStart().length;
  for (let j = valueEntry.relativeLine + 1; j < actionLines.length; j += 1) {
    const line = actionLines[j] ?? "";
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent <= keyIndent) {
      break;
    }
    return normalizeFrameworkValue(trimmed);
  }

  return "";
}
