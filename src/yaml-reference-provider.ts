import * as vscode from "vscode";
import * as path from "path";
import { getFilesContentMap } from "./core/get-files-content-map";
import { getWorkspaceRoot } from "./utils/get-workspace-root";
import { Cache } from "./utils/cache";
import { ILogger } from "./utils/logger";
import { getFilesReferencesInLinesMap } from "./core/get-files-references-in-lines-map";
import { FilesFoundInLinesMap } from "./core/get-files-found-in-lines-map";
import { FilesContentMap } from "./core/get-files-content-map";

const GHERKIN_KEYS = ["Given", "Then", "And", "But", "When"];
const ROOT_NON_CASE_KEYS = new Set([
  "Apps",
  "Devices",
  "Environments",
  "Timeout",
  "chromeDriverPath",
]);
const CLI_VAR_PATTERN = /^\$AND_CLI_([A-Za-z0-9_]+)\$$/;

export class YamlReferenceProvider implements vscode.ReferenceProvider {
  constructor(
    private cache?: Cache<vscode.Location[]>,
    private logger?: ILogger
  ) {}

  provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Location[] {
    this.logger?.startPerformanceLog("Total time: provideReferences");

    const name = this.getClicked(document, position);
    this.logger?.log("Looking for references of: ", name);

    const cacheKey = `${vscode.workspace.name}-${name}-refs`;
    const cachedResult = this.cache?.get(cacheKey);

    if (cachedResult) {
      this.logger?.endPerformanceLog("Total time: provideReferences");
      this.logger?.log("Returning cached references result");
      return cachedResult;
    }

    const root = getWorkspaceRoot();
    const filesContentMap = getFilesContentMap(root);
    const frameworkLocations = this.getFrameworkReferences(
      document,
      position,
      name,
      filesContentMap
    );
    const locations =
      frameworkLocations.length > 0
        ? frameworkLocations
        : this.getLocations(getFilesReferencesInLinesMap(filesContentMap, name));
    this.cache?.set(cacheKey, locations);
    this.logger?.endPerformanceLog("Total time: provideReferences");

    return locations;
  }

  private createLocationFromFilePathAndLineNumber(
    filePath: AbsoluteFilePath,
    lineNumber: LineNumber
  ): vscode.Location {
    const uri = vscode.Uri.file(filePath);
    const pos = new vscode.Position(lineNumber - 1, 0);
    return new vscode.Location(uri, pos);
  }

  private createLocationsFromFilePath(
    filePath: AbsoluteFilePath,
    lineNumbers: LineNumber[]
  ): vscode.Location[] {
    return lineNumbers.map((lineNumber) =>
      this.createLocationFromFilePathAndLineNumber(filePath, lineNumber)
    );
  }

  private getLocations(filePathToLineNumbersMap: FilesFoundInLinesMap) {
    return Object.entries(filePathToLineNumbersMap).flatMap(
      ([filePath, lineNumbers]) =>
        this.createLocationsFromFilePath(filePath, lineNumbers)
    );
  }

  private getClicked(document: vscode.TextDocument, position: vscode.Position) {
    const range = document.getWordRangeAtPosition(position, /[^ \{\}\[\]\,]+/);
    const name = document.getText(range);

    return name;
  }

  private normalizeValue(text: string): string {
    return text.replace(/^['"]|['"]$/g, "").replace(/:$/, "").trim();
  }

  private getCurrentKey(document: vscode.TextDocument, position: vscode.Position) {
    const linePrefix = document.lineAt(position).text.slice(0, position.character);
    const trimmed = linePrefix.trimStart();
    const keyMatch = trimmed.match(/^-?\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
    return keyMatch?.[1];
  }

  private getListParentKey(document: vscode.TextDocument, position: vscode.Position): string | undefined {
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

  private isCaseValueContext(document: vscode.TextDocument, position: vscode.Position): boolean {
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
        return this.normalizeValue(typeMatch[1]) === "case";
      }
    }
    return false;
  }

  private getFrameworkReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    rawName: string,
    filesContentMap: FilesContentMap
  ): vscode.Location[] {
    const name = this.normalizeValue(rawName);
    const currentKey = this.getCurrentKey(document, position);
    const listParentKey = this.getListParentKey(document, position);
    if (!name) {
      return [];
    }

    if (
      (currentKey === "Value" && this.isCaseValueContext(document, position)) ||
      currentKey === "Case" ||
      listParentKey === "Precases" ||
      listParentKey === "Aftercases"
    ) {
      return this.findCaseReferences(filesContentMap, name);
    }

    if (currentKey && GHERKIN_KEYS.includes(currentKey)) {
      return this.findStepReferences(filesContentMap, name);
    }

    if (currentKey === "Environment" || listParentKey === "Inherit") {
      return this.findEnvironmentReferences(filesContentMap, name);
    }

    if (currentKey === "App" || currentKey === "app") {
      return this.findAppReferences(filesContentMap, name);
    }

    if (currentKey === "Role" || currentKey === "role") {
      return this.findRoleReferences(filesContentMap, name);
    }

    return [];
  }

  private findCaseReferences(filesContentMap: FilesContentMap, name: string): vscode.Location[] {
    const locations: vscode.Location[] = [];
    Object.entries(filesContentMap).forEach(([filePath, lines]) => {
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        const currentIndent = line.length - line.trimStart().length;

        const typeCaseValueMatch = trimmed.match(/^Value\s*:\s*(.+)$/);
        if (typeCaseValueMatch) {
          const value = this.normalizeValue(typeCaseValueMatch[1]);
          if (value === name && this.previousActionTypeIsCase(lines, index, currentIndent)) {
            locations.push(this.createLocationFromFilePathAndLineNumber(filePath, index + 1));
          }
        }

        const listItemMatch = trimmed.match(/^-\s*(.+)$/);
        if (listItemMatch) {
          const value = this.normalizeValue(listItemMatch[1]);
          if (value !== name) {
            return;
          }
          const parent = this.getParentCollectionKey(lines, index, currentIndent);
          if (parent === "Precases" || parent === "Aftercases") {
            locations.push(this.createLocationFromFilePathAndLineNumber(filePath, index + 1));
          }
        }

        const setCaseMatch = trimmed.match(/^Case\s*:\s*(.+)$/);
        if (setCaseMatch) {
          const value = this.normalizeValue(setCaseMatch[1]);
          if (value === name && this.isUnderCasesCollection(lines, index, currentIndent)) {
            locations.push(this.createLocationFromFilePathAndLineNumber(filePath, index + 1));
          }
        }
      });
    });
    return locations;
  }

  private findStepReferences(filesContentMap: FilesContentMap, stepName: string): vscode.Location[] {
    const locations: vscode.Location[] = [];
    Object.entries(filesContentMap).forEach(([filePath, lines]) => {
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        for (const key of GHERKIN_KEYS) {
          const match = trimmed.match(new RegExp(`^${key}\\s*:\\s*(.+)$`));
          if (match && this.normalizeValue(match[1]) === stepName) {
            locations.push(this.createLocationFromFilePathAndLineNumber(filePath, index + 1));
            return;
          }
        }
      });
    });
    return locations;
  }

  private findEnvironmentReferences(
    filesContentMap: FilesContentMap,
    environmentName: string
  ): vscode.Location[] {
    const locations: vscode.Location[] = [];
    Object.entries(filesContentMap).forEach(([filePath, lines]) => {
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        const currentIndent = line.length - line.trimStart().length;

        const envMatch = trimmed.match(/^Environment\s*:\s*(.+)$/);
        if (envMatch && this.normalizeValue(envMatch[1]) === environmentName) {
          locations.push(this.createLocationFromFilePathAndLineNumber(filePath, index + 1));
        }

        const listItemMatch = trimmed.match(/^-\s*(.+)$/);
        if (!listItemMatch) {
          return;
        }
        const value = this.normalizeValue(listItemMatch[1]);
        if (value !== environmentName) {
          return;
        }
        const parent = this.getParentCollectionKey(lines, index, currentIndent);
        if (parent === "Inherit") {
          locations.push(this.createLocationFromFilePathAndLineNumber(filePath, index + 1));
        }
      });
    });
    return locations;
  }

  private findRoleReferences(filesContentMap: FilesContentMap, roleName: string): vscode.Location[] {
    const locations: vscode.Location[] = [];
    const varsMap = this.buildVarsMap(filesContentMap);
    Object.entries(filesContentMap).forEach(([filePath, lines]) => {
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        const match = trimmed.match(/^-?\s*(Role|role)\s*:\s*(.+)$/);
        if (!match) {
          return;
        }
        if (this.isConfigPath(filePath) && match[1] === "role") {
          return;
        }
        const values = this.normalizeValue(match[2])
          .split(",")
          .map((part) => part.trim())
          .flatMap((part) => this.resolveRoleToken(part, varsMap));
        if (values.includes(roleName)) {
          locations.push(this.createLocationFromFilePathAndLineNumber(filePath, index + 1));
        }
      });
    });
    return locations;
  }

  private findAppReferences(filesContentMap: FilesContentMap, appName: string): vscode.Location[] {
    const locations: vscode.Location[] = [];
    Object.entries(filesContentMap).forEach(([filePath, lines]) => {
      lines.forEach((line, index) => {
        const match = line.trim().match(/^App\s*:\s*(.+)$/);
        if (!match) {
          return;
        }
        if (this.normalizeValue(match[1]) !== appName) {
          return;
        }
        locations.push(this.createLocationFromFilePathAndLineNumber(filePath, index + 1));
      });
    });
    return locations;
  }

  private previousActionTypeIsCase(
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
        return match ? this.normalizeValue(match[1]) === "case" : false;
      }
      if (indent === currentIndent && /^-\s/.test(trimmed)) {
        return false;
      }
    }
    return false;
  }

  private getParentCollectionKey(
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

  private isUnderCasesCollection(
    lines: FileContentLine[],
    lineIndex: number,
    currentIndent: number
  ): boolean {
    return this.getParentCollectionKey(lines, lineIndex, currentIndent) === "Cases";
  }

  private isConfigPath(filePath: string): boolean {
    return path.basename(filePath).toLowerCase() === "config.yaml";
  }

  private isCliVar(name: string): boolean {
    return CLI_VAR_PATTERN.test(name);
  }

  private isMainRoleVar(name: string): boolean {
    return name === "$AND_CLI_MAINROLE$";
  }

  private getCliVarName(name: string): string {
    const match = name.match(CLI_VAR_PATTERN);
    return match?.[1] ?? name;
  }

  private buildVarsMap(filesContentMap: FilesContentMap): Map<string, Set<string>> {
    const varsMap = new Map<string, Set<string>>();
    Object.values(filesContentMap).forEach((lines) => {
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        const keyValueMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
        if (!keyValueMatch) {
          return;
        }
        if (!this.isInsideVarsSection(lines, index)) {
          return;
        }
        const [, key, valueRaw] = keyValueMatch;
        const value = this.normalizeValue(valueRaw);
        const existing = varsMap.get(key) ?? new Set<string>();
        value
          .split(",")
          .map((part) => this.normalizeValue(part))
          .filter(Boolean)
          .forEach((part) => existing.add(part));
        varsMap.set(key, existing);
      });
    });
    return varsMap;
  }

  private isInsideVarsSection(lines: FileContentLine[], lineIndex: number): boolean {
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

  private resolveRoleToken(token: string, varsMap: Map<string, Set<string>>): string[] {
    const normalized = this.normalizeValue(token);
    if (!this.isCliVar(normalized)) {
      return [normalized];
    }
    if (this.isMainRoleVar(normalized)) {
      return [];
    }
    const key = this.getCliVarName(normalized);
    return [...(varsMap.get(key) ?? [])];
  }
}
