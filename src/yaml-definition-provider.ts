import * as vscode from "vscode";
import * as path from "path";
import { getFilesContentMap } from "./core/get-files-content-map";
import { getWorkspaceRoot } from "./utils/get-workspace-root";

import { Cache } from "./utils/cache";
import { ILogger } from "./utils/logger";
import {
  getFilesFoundInLinesMap,
  FilesFoundInLinesMap,
  isDefinition,
} from "./core/get-files-found-in-lines-map";
import { getFilesReferencesInLinesMap } from "./core/get-files-references-in-lines-map";
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

export class YamlDefinitionProvider implements vscode.DefinitionProvider {
  constructor(
    private cache?: Cache<vscode.Location[]>,
    private logger?: ILogger
  ) {}

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Location[] {
    this.logger?.startPerformanceLog("Total time: provideDefinition");

    const name = this.getSemanticNameAtPosition(document, position) ?? this.getClicked(document, position);
    this.logger?.log("Looking for defenition of: ", name);

    const cacheKey = `${vscode.workspace.name}-${name}`;
    const cachedResult = this.cache?.get(cacheKey);

    if (cachedResult) {
      this.logger?.endPerformanceLog("Total time: provideDefinition");
      this.logger?.log("Returning cached result");

      return cachedResult;
    }

    const root = getWorkspaceRoot();

    this.logger?.startPerformanceLog("Total time: getFilesFoundInLinesMap");
    this.logger?.startPerformanceLog("Total time: getFilesContentMap");
    const filesContentMap = getFilesContentMap(root);
    this.logger?.endPerformanceLog("Total time: getFilesContentMap");

    const frameworkLocations = this.getFrameworkLocations(
      document,
      position,
      name,
      filesContentMap
    );
    const locations =
      frameworkLocations.length > 0
        ? frameworkLocations
        : this.getLocations(
            this.isClickedOnDefinition(document, position, name)
              ? getFilesReferencesInLinesMap(filesContentMap, name)
              : getFilesFoundInLinesMap(filesContentMap, name)
          );
    this.logger?.endPerformanceLog("Total time: getFilesFoundInLinesMap");

    this.cache?.set(cacheKey, locations);

    this.logger?.endPerformanceLog("Total time: provideDefinition");

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

  private getFrameworkLocations(
    document: vscode.TextDocument,
    position: vscode.Position,
    rawName: string,
    filesContentMap: FilesContentMap
  ): vscode.Location[] {
    const name = this.normalizeValue(rawName);
    const currentKey = this.getCurrentKey(document, position);
    const lineText = document.lineAt(position.line).text;
    const fullLineKey = lineText.trimStart().match(/^-?\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:/)?.[1];
    const effectiveKey = currentKey ?? fullLineKey;
    const listParentKey = this.getListParentKey(document, position);
    if (!name) {
      return [];
    }

    if (
      (effectiveKey === "Value" && this.isCaseValueContext(document, position)) ||
      effectiveKey === "Case" ||
      listParentKey === "Precases" ||
      listParentKey === "Aftercases"
    ) {
      return this.uniqueLocations([
        ...this.findCaseDefinitions(filesContentMap, name),
        ...this.findCaseDefinitionsByStepText(filesContentMap, name),
      ]);
    }

    if (effectiveKey && GHERKIN_KEYS.includes(effectiveKey)) {
      return this.uniqueLocations([
        ...this.findStepDefinitions(filesContentMap, name),
        ...this.findCaseDefinitionsByStepText(filesContentMap, name),
      ]);
    }

    if (effectiveKey === "Environment" || listParentKey === "Inherit") {
      return this.isConfigDefinitionContext(document)
        ? this.findEnvironmentReferences(filesContentMap, name)
        : this.findEnvironmentDefinitions(filesContentMap, name);
    }

    if (effectiveKey === "App" || effectiveKey === "app") {
      return this.isConfigDefinitionContext(document)
        ? this.findAppReferences(filesContentMap, name)
        : this.findAppDefinitions(filesContentMap, name);
    }

    if (effectiveKey === "Role" || effectiveKey === "role") {
      if (this.isCliVar(name)) {
        if (this.isMainRoleVar(name)) {
          return [];
        }
        return this.findVarDefinitions(filesContentMap, this.getCliVarName(name));
      }
      return this.isRoleDefinitionContext(document, position) || this.isConfigDefinitionContext(document)
        ? this.findRoleReferences(filesContentMap, name)
        : this.findRoleDefinitions(filesContentMap, name);
    }

    return [];
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

  private findCaseDefinitions(filesContentMap: FilesContentMap, name: string): vscode.Location[] {
    return this.findByLinePredicate(filesContentMap, (line) => {
      const match = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
      if (!match) {
        return false;
      }
      const indentation = line.length - line.trimStart().length;
      return indentation === 0 && !ROOT_NON_CASE_KEYS.has(match[1]) && match[1] === name;
    });
  }

  private findStepDefinitions(filesContentMap: FilesContentMap, stepText: string): vscode.Location[] {
    return this.findByLinePredicate(filesContentMap, (line) => {
      const match = line.trim().match(/^Step\s*:\s*(.+)$/);
      if (!match) {
        return false;
      }
      return this.normalizeValue(match[1]) === stepText;
    });
  }

  private findCaseDefinitionsByStepText(
    filesContentMap: FilesContentMap,
    stepText: string
  ): vscode.Location[] {
    const caseNames = this.getCaseNamesForStepText(filesContentMap, stepText);
    return this.uniqueLocations(
      caseNames.flatMap((caseName) => this.findCaseDefinitions(filesContentMap, caseName))
    );
  }

  private getCaseNamesForStepText(
    filesContentMap: FilesContentMap,
    stepText: string
  ): string[] {
    const names = new Set<string>();
    Object.values(filesContentMap).forEach((lines) => {
      let currentCaseName: string | undefined;
      lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          return;
        }
        const indent = line.length - line.trimStart().length;
        const topDef = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
        if (indent === 0 && topDef) {
          currentCaseName = ROOT_NON_CASE_KEYS.has(topDef[1]) ? undefined : topDef[1];
          return;
        }
        if (!currentCaseName) {
          return;
        }
        const stepMatch = trimmed.match(/^Step\s*:\s*(.+)$/);
        if (!stepMatch) {
          return;
        }
        if (this.normalizeValue(stepMatch[1]) === stepText) {
          names.add(currentCaseName);
        }
      });
    });
    return [...names];
  }

  private findEnvironmentDefinitions(
    filesContentMap: FilesContentMap,
    environmentName: string
  ): vscode.Location[] {
    const locations: vscode.Location[] = [];

    Object.entries(filesContentMap).forEach(([filePath, lines]) => {
      if (!this.isConfigPath(filePath)) {
        return;
      }
      let inEnvironments = false;
      let environmentsIndent = 0;

      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (!inEnvironments && /^Environments\s*:\s*$/.test(trimmed)) {
          inEnvironments = true;
          environmentsIndent = line.length - line.trimStart().length;
          return;
        }

        const indent = line.length - line.trimStart().length;
        if (inEnvironments && indent <= environmentsIndent && trimmed.length > 0) {
          inEnvironments = false;
        }
        if (!inEnvironments) {
          return;
        }

        const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
        if (!match || match[1] !== environmentName) {
          return;
        }

        locations.push(this.createLocationFromFilePathAndLineNumber(filePath, index + 1));
      });
    });

    return locations;
  }

  private findRoleDefinitions(filesContentMap: FilesContentMap, roleName: string): vscode.Location[] {
    const locations: vscode.Location[] = [];
    Object.entries(filesContentMap).forEach(([filePath, lines]) => {
      if (!this.isConfigPath(filePath)) {
        return;
      }
      lines.forEach((line, index) => {
        const match = line.trim().match(/^-?\s*role\s*:\s*(.+)$/);
        if (!match) {
          return;
        }
        const values = this.normalizeValue(match[1])
          .split(",")
          .map((part) => part.trim());
        if (!values.includes(roleName)) {
          return;
        }
        locations.push(this.createLocationFromFilePathAndLineNumber(filePath, index + 1));
      });
    });
    return locations;
  }

  private findRoleReferences(filesContentMap: FilesContentMap, roleName: string): vscode.Location[] {
    const locations: vscode.Location[] = [];
    const varsMap = this.buildVarsMap(filesContentMap);
    Object.entries(filesContentMap).forEach(([filePath, lines]) => {
      lines.forEach((line, index) => {
        const match = line.trim().match(/^-?\s*(Role|role)\s*:\s*(.+)$/);
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
        if (!values.includes(roleName)) {
          return;
        }
        locations.push(this.createLocationFromFilePathAndLineNumber(filePath, index + 1));
      });
    });
    return locations;
  }

  private isRoleDefinitionContext(
    document: vscode.TextDocument,
    position: vscode.Position
  ): boolean {
    const currentKey = this.getCurrentKey(document, position);
    if (currentKey !== "role" || !this.isConfigPath(document.fileName)) {
      return false;
    }

    const lineText = document.lineAt(position.line).text;
    const colonIdx = lineText.indexOf(":");
    return colonIdx >= 0 && position.character > colonIdx;
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
        const parent = this.getListParentKeyFromLines(lines, index, currentIndent);
        if (parent === "Inherit") {
          locations.push(this.createLocationFromFilePathAndLineNumber(filePath, index + 1));
        }
      });
    });
    return locations;
  }

  private findAppDefinitions(filesContentMap: FilesContentMap, appName: string): vscode.Location[] {
    const locations: vscode.Location[] = [];
    Object.entries(filesContentMap).forEach(([filePath, lines]) => {
      if (!this.isConfigPath(filePath)) {
        return;
      }
      let inApps = false;
      let appsIndent = 0;
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (!inApps && /^Apps\s*:\s*$/.test(trimmed)) {
          inApps = true;
          appsIndent = line.length - line.trimStart().length;
          return;
        }
        const indent = line.length - line.trimStart().length;
        if (inApps && indent <= appsIndent && trimmed.length > 0) {
          inApps = false;
        }
        if (!inApps) {
          return;
        }
        const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
        if (match && match[1] === appName && indent === appsIndent + 2) {
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

  private getListParentKeyFromLines(
    lines: FileContentLine[],
    lineIndex: number,
    currentIndent: number
  ): string | undefined {
    for (let i = lineIndex - 1; i >= 0; i -= 1) {
      const trimmed = lines[i].trim();
      if (trimmed.length === 0 || trimmed.startsWith("#")) {
        continue;
      }
      const indent = lines[i].length - lines[i].trimStart().length;
      if (indent < currentIndent) {
        const keyMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*$/);
        return keyMatch?.[1];
      }
    }
    return undefined;
  }

  private isConfigPath(filePath: string): boolean {
    return path.basename(filePath).toLowerCase() === "config.yaml";
  }

  private isConfigDefinitionContext(document: vscode.TextDocument): boolean {
    return this.isConfigPath(document.fileName);
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

  private findVarDefinitions(
    filesContentMap: FilesContentMap,
    varName: string
  ): vscode.Location[] {
    const locations: vscode.Location[] = [];
    Object.entries(filesContentMap).forEach(([filePath, lines]) => {
      lines.forEach((line, index) => {
        if (!this.isInsideVarsSection(lines, index)) {
          return;
        }
        const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
        if (!match || match[1] !== varName) {
          return;
        }
        locations.push(this.createLocationFromFilePathAndLineNumber(filePath, index + 1));
      });
    });
    return locations;
  }

  private findByLinePredicate(
    filesContentMap: FilesContentMap,
    predicate: (line: string, lineIndex: number) => boolean
  ): vscode.Location[] {
    const locations: vscode.Location[] = [];
    Object.entries(filesContentMap).forEach(([filePath, lines]) => {
      lines.forEach((line, index) => {
        if (predicate(line, index)) {
          locations.push(this.createLocationFromFilePathAndLineNumber(filePath, index + 1));
        }
      });
    });
    return locations;
  }

  private getSemanticNameAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): string | undefined {
    const line = document.lineAt(position).text;
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;
    const currentKey = this.getCurrentKey(document, position);
    const listParentKey = this.getListParentKey(document, position);
    const fullLineKey = line.trimStart().match(/^-?\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:/)?.[1];
    const effectiveKey = currentKey ?? fullLineKey;

    const topDef = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
    if (indent === 0 && topDef && !ROOT_NON_CASE_KEYS.has(topDef[1])) {
      const start = line.indexOf(topDef[1]);
      const end = start + topDef[1].length;
      if (position.character >= start && position.character <= end) {
        return topDef[1];
      }
    }

    if (
      effectiveKey === "Value" ||
      effectiveKey === "Case" ||
      effectiveKey === "Step" ||
      effectiveKey === "Environment" ||
      effectiveKey === "Role" ||
      effectiveKey === "role" ||
      effectiveKey === "App" ||
      effectiveKey === "app" ||
      (effectiveKey && GHERKIN_KEYS.includes(effectiveKey))
    ) {
      const colon = line.indexOf(":");
      if (colon >= 0 && position.character > colon) {
        const value = this.normalizeValue(line.slice(colon + 1));
        if (value) {
          return value;
        }
      }
    }

    const listItem = trimmed.match(/^-\s*(.+)$/);
    if (
      listItem &&
      (listParentKey === "Precases" || listParentKey === "Aftercases" || listParentKey === "Inherit")
    ) {
      return this.normalizeValue(listItem[1]);
    }

    return undefined;
  }

  private uniqueLocations(locations: vscode.Location[]): vscode.Location[] {
    const seen = new Set<string>();
    return locations.filter((loc) => {
      const key = `${loc.uri.fsPath}:${loc.range.start.line}:${loc.range.start.character}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private isClickedOnDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    name: string
  ): boolean {
    const currentLine = document.lineAt(position.line).text;
    return isDefinition(currentLine, name);
  }
}
