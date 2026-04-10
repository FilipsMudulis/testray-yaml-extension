import * as vscode from "vscode";
import { FilesContentMap, getFilesContentMap } from "./core/get-files-content-map";
import { getFilesFoundInLinesMap } from "./core/get-files-found-in-lines-map";
import { getFilesReferencesInLinesMap } from "./core/get-files-references-in-lines-map";
import { getWorkspaceRoot } from "./utils/get-workspace-root";
import { ILogger } from "./utils/logger";
import {
  detectSemanticRenameKind,
  GHERKIN_KEYS,
  normalizeFrameworkValue,
  ROOT_NON_CASE_KEYS,
  getParentCollectionKey,
  isUnderCasesCollection,
  previousActionTypeIsCase,
} from "./yaml-framework-context";

function normalizeSymbolName(name: string): string {
  return name.endsWith(":") ? name.slice(0, -1) : name;
}

function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getClickedRange(
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.Range | undefined {
  return document.getWordRangeAtPosition(position, /[^ \{\}\[\]\,]+/);
}

function getReferenceRangesInLine(
  line: string,
  searchText: string
): Array<{ start: number; end: number }> {
  const escapedSearchText = escapeForRegex(searchText);
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9_.-])(${escapedSearchText})(?=[^A-Za-z0-9_.-]|$)`,
    "g"
  );
  const ranges: Array<{ start: number; end: number }> = [];

  for (const match of line.matchAll(pattern)) {
    const wholeMatch = match[0];
    const symbolPart = match[2];

    if (wholeMatch === undefined || symbolPart === undefined) {
      continue;
    }

    const wholeStart = match.index ?? 0;
    const symbolOffset = wholeMatch.lastIndexOf(symbolPart);
    const symbolStart = wholeStart + symbolOffset;

    ranges.push({
      start: symbolStart,
      end: symbolStart + symbolPart.length,
    });
  }

  return ranges;
}

function replaceValueAfterKey(
  line: string,
  lineNumber: number,
  key: "Value" | "Case" | "Environment" | "Step",
  oldValue: string
): vscode.Range | undefined {
  const trimmed = line.trim();
  const match = trimmed.match(new RegExp(`^${key}\\s*:\\s*(.+)$`));
  if (!match) {
    return undefined;
  }
  const valuePart = match[1];
  if (normalizeFrameworkValue(valuePart) !== oldValue) {
    return undefined;
  }
  const colonIdx = trimmed.indexOf(":");
  const rawAfterColon = trimmed.slice(colonIdx + 1);
  const trimmedVal = rawAfterColon.trimStart();
  const startInTrimmed =
    trimmed.length - rawAfterColon.length + rawAfterColon.indexOf(trimmedVal);
  const lineOffset = line.indexOf(trimmed);
  if (lineOffset < 0) {
    return undefined;
  }
  const start = lineOffset + startInTrimmed;
  const end = start + trimmedVal.length;
  return new vscode.Range(lineNumber, start, lineNumber, end);
}

function collectCaseRenameEdits(
  filesContentMap: FilesContentMap,
  oldName: string,
  newName: string,
  edit: vscode.WorkspaceEdit
): void {
  Object.entries(filesContentMap).forEach(([filePath, lines]) => {
    const uri = vscode.Uri.file(filePath);
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const currentIndent = line.length - line.trimStart().length;

      if (currentIndent === 0) {
        const topMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
        if (
          topMatch &&
          !ROOT_NON_CASE_KEYS.has(topMatch[1]) &&
          topMatch[1] === oldName
        ) {
          const nameStart = line.indexOf(oldName);
          if (nameStart >= 0) {
            edit.replace(
              uri,
              new vscode.Range(index, nameStart, index, nameStart + oldName.length),
              newName
            );
          }
        }
      }

      const valueRange = replaceValueAfterKey(line, index, "Value", oldName);
      if (
        valueRange &&
        previousActionTypeIsCase(lines, index, currentIndent)
      ) {
        edit.replace(uri, valueRange, newName);
      }

      const listItemMatch = trimmed.match(/^-\s*(.+)$/);
      if (listItemMatch) {
        const value = normalizeFrameworkValue(listItemMatch[1]);
        if (value !== oldName) {
          return;
        }
        const parent = getParentCollectionKey(lines, index, currentIndent);
        if (parent === "Precases" || parent === "Aftercases") {
          const nameStart = line.indexOf(oldName);
          if (nameStart >= 0) {
            edit.replace(
              uri,
              new vscode.Range(index, nameStart, index, nameStart + oldName.length),
              newName
            );
          }
        }
      }

      const setCaseMatch = trimmed.match(/^Case\s*:\s*(.+)$/);
      if (setCaseMatch) {
        const value = normalizeFrameworkValue(setCaseMatch[1]);
        if (
          value === oldName &&
          isUnderCasesCollection(lines, index, currentIndent)
        ) {
          const vr = replaceValueAfterKey(line, index, "Case", oldName);
          if (vr) {
            edit.replace(uri, vr, newName);
          }
        }
      }
    });
  });
}

function collectStepRenameEdits(
  filesContentMap: FilesContentMap,
  oldName: string,
  newName: string,
  edit: vscode.WorkspaceEdit
): void {
  Object.entries(filesContentMap).forEach(([filePath, lines]) => {
    const uri = vscode.Uri.file(filePath);
    lines.forEach((line, index) => {
      const trimmed = line.trim();

      for (const key of GHERKIN_KEYS) {
        const re = new RegExp(`^(\\s*-\\s*)?${key}\\s*:\\s*(.+)$`);
        const m = trimmed.match(re);
        if (!m) {
          continue;
        }
        const rawValue = m[2];
        if (normalizeFrameworkValue(rawValue) !== oldName) {
          continue;
        }
        const valueStart = line.indexOf(rawValue);
        if (valueStart < 0) {
          continue;
        }
        const trimmedVal = rawValue.trim();
        const inner = rawValue.indexOf(trimmedVal);
        const start = valueStart + inner;
        const end = start + trimmedVal.length;
        edit.replace(uri, new vscode.Range(index, start, index, end), newName);
        return;
      }

      const stepRange = replaceValueAfterKey(line, index, "Step", oldName);
      if (stepRange) {
        edit.replace(uri, stepRange, newName);
      }
    });
  });
}

function collectEnvironmentRenameEdits(
  filesContentMap: FilesContentMap,
  oldName: string,
  newName: string,
  edit: vscode.WorkspaceEdit
): void {
  Object.entries(filesContentMap).forEach(([filePath, lines]) => {
    const uri = vscode.Uri.file(filePath);
    let inEnvironments = false;
    let environmentsIndent = 0;

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const indent = line.length - line.trimStart().length;

      if (!inEnvironments && /^Environments\s*:\s*$/.test(trimmed)) {
        inEnvironments = true;
        environmentsIndent = indent;
        return;
      }

      if (
        inEnvironments &&
        indent <= environmentsIndent &&
        trimmed.length > 0 &&
        !/^Environments\s*:\s*$/.test(trimmed)
      ) {
        inEnvironments = false;
      }

      if (!inEnvironments) {
        return;
      }

      const defMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
      if (defMatch && defMatch[1] === oldName) {
        const nameStart = line.indexOf(oldName);
        if (nameStart >= 0) {
          edit.replace(
            uri,
            new vscode.Range(index, nameStart, index, nameStart + oldName.length),
            newName
          );
        }
        return;
      }

      const envMatch = trimmed.match(/^Environment\s*:\s*(.+)$/);
      if (envMatch && normalizeFrameworkValue(envMatch[1]) === oldName) {
        const vr = replaceValueAfterKey(line, index, "Environment", oldName);
        if (vr) {
          edit.replace(uri, vr, newName);
        }
        return;
      }

      const listItemMatch = trimmed.match(/^-\s*(.+)$/);
      if (listItemMatch) {
        const value = normalizeFrameworkValue(listItemMatch[1]);
        if (value !== oldName) {
          return;
        }
        const parent = getParentCollectionKey(lines, index, indent);
        if (parent === "Inherit") {
          const nameStart = line.indexOf(oldName);
          if (nameStart >= 0) {
            edit.replace(
              uri,
              new vscode.Range(index, nameStart, index, nameStart + oldName.length),
              newName
            );
          }
        }
      }
    });
  });
}

function collectRoleRenameEdits(
  filesContentMap: FilesContentMap,
  oldName: string,
  newName: string,
  edit: vscode.WorkspaceEdit
): void {
  Object.entries(filesContentMap).forEach(([filePath, lines]) => {
    const uri = vscode.Uri.file(filePath);
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const match = trimmed.match(/^(Role|role)\s*:\s*(.+)$/);
      if (!match) {
        return;
      }
      const rolePart = match[2];
      const base = line.indexOf(rolePart);
      if (base < 0) {
        return;
      }
      let offset = 0;
      for (const segment of rolePart.split(",")) {
        const segTrim = segment.trim();
        if (segTrim === oldName) {
          const idxInSegment = segment.indexOf(segTrim);
          const start = base + offset + idxInSegment;
          edit.replace(
            uri,
            new vscode.Range(index, start, index, start + segTrim.length),
            newName
          );
        }
        offset += segment.length + 1;
      }
    });
  });
}

function collectGenericRenameEdits(
  filesContentMap: FilesContentMap,
  currentSymbol: string,
  normalizedNewName: string,
  edit: vscode.WorkspaceEdit
): void {
  const definitionsMap = getFilesFoundInLinesMap(filesContentMap, currentSymbol);
  const referencesMap = getFilesReferencesInLinesMap(filesContentMap, currentSymbol);

  Object.entries(definitionsMap).forEach(([filePath, lineNumbers]) => {
    const uri = vscode.Uri.file(filePath);
    const lines = filesContentMap[filePath];

    lineNumbers.forEach((lineNumber) => {
      const lineText = lines[lineNumber - 1] ?? "";
      const symbolIndex = lineText.indexOf(currentSymbol);

      if (symbolIndex < 0) {
        return;
      }

      const line = lineNumber - 1;
      const rangeToReplace = new vscode.Range(
        new vscode.Position(line, symbolIndex),
        new vscode.Position(line, symbolIndex + currentSymbol.length)
      );
      edit.replace(uri, rangeToReplace, normalizedNewName);
    });
  });

  Object.entries(referencesMap).forEach(([filePath, lineNumbers]) => {
    const uri = vscode.Uri.file(filePath);
    const lines = filesContentMap[filePath];

    lineNumbers.forEach((lineNumber) => {
      const lineText = lines[lineNumber - 1] ?? "";
      const ranges = getReferenceRangesInLine(lineText, currentSymbol);
      const line = lineNumber - 1;

      ranges.forEach(({ start, end }) => {
        const rangeToReplace = new vscode.Range(
          new vscode.Position(line, start),
          new vscode.Position(line, end)
        );
        edit.replace(uri, rangeToReplace, normalizedNewName);
      });
    });
  });
}

export class YamlRenameProvider implements vscode.RenameProvider {
  constructor(private logger?: ILogger) {}

  prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Range | { range: vscode.Range; placeholder: string } {
    const range = getClickedRange(document, position);

    if (!range) {
      throw new Error("No symbol found at cursor position.");
    }

    const clickedName = document.getText(range);
    const normalizedName = normalizeSymbolName(clickedName);

    if (!normalizedName) {
      throw new Error("Cannot rename empty symbol.");
    }

    const placeholderRange = new vscode.Range(
      range.start,
      range.start.translate(0, normalizedName.length)
    );

    return {
      range: placeholderRange,
      placeholder: normalizedName,
    };
  }

  provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string
  ): vscode.WorkspaceEdit {
    this.logger?.startPerformanceLog("Total time: provideRenameEdits");

    const range = getClickedRange(document, position);
    if (!range) {
      throw new Error("No symbol found at cursor position.");
    }

    const currentSymbol = normalizeSymbolName(document.getText(range));
    const normalizedNewName = normalizeSymbolName(newName.trim());

    if (!normalizedNewName) {
      throw new Error("New name cannot be empty.");
    }

    const root = getWorkspaceRoot();
    const filesContentMap = getFilesContentMap(root);
    const edit = new vscode.WorkspaceEdit();
    const kind = detectSemanticRenameKind(document, position);

    this.logger?.log("Semantic rename kind:", kind, currentSymbol);

    switch (kind) {
      case "case":
        collectCaseRenameEdits(filesContentMap, currentSymbol, normalizedNewName, edit);
        break;
      case "step":
        collectStepRenameEdits(filesContentMap, currentSymbol, normalizedNewName, edit);
        break;
      case "environment":
        collectEnvironmentRenameEdits(
          filesContentMap,
          currentSymbol,
          normalizedNewName,
          edit
        );
        break;
      case "role":
        collectRoleRenameEdits(filesContentMap, currentSymbol, normalizedNewName, edit);
        break;
      default:
        collectGenericRenameEdits(
          filesContentMap,
          currentSymbol,
          normalizedNewName,
          edit
        );
    }

    this.logger?.endPerformanceLog("Total time: provideRenameEdits");
    return edit;
  }
}
