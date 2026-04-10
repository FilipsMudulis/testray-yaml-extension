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

    const name = this.getSemanticNameAtPosition(document, position) ?? this.getClicked(document, position);
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
    const frameworkContext = this.isFrameworkReferenceContext(document, position);
    const frameworkLocations = this.getFrameworkReferences(
      document,
      position,
      name,
      filesContentMap
    );
    const locations =
      frameworkContext
        ? frameworkLocations
        : frameworkLocations.length > 0
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
    const lineText = document.lineAt(position.line).text;
    const fullLineKey = lineText.trimStart().match(/^-?\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:/)?.[1];
    const effectiveKey = currentKey ?? fullLineKey;
    const listParentKey = this.getListParentKey(document, position);
    if (!name) {
      return [];
    }

    if (this.isCaseDefinitionCursor(document, position, name)) {
      return this.uniqueLocations([
        ...this.findCaseReferences(filesContentMap, name),
        ...this.findStepReferencesByCaseName(filesContentMap, name),
      ]);
    }

    if (this.isStepDefinitionCursor(document, position, name)) {
      const caseNames = this.getCaseNamesForStepText(filesContentMap, name);
      return this.uniqueLocations([
        ...this.findStepReferences(filesContentMap, name),
        ...caseNames.flatMap((caseName) => this.findCaseReferences(filesContentMap, caseName)),
      ]);
    }

    if (
      (effectiveKey === "Value" && this.isCaseValueContext(document, position)) ||
      effectiveKey === "Case" ||
      listParentKey === "Precases" ||
      listParentKey === "Aftercases"
    ) {
      return this.uniqueLocations([
        ...this.findCaseReferences(filesContentMap, name),
        ...this.findStepReferences(filesContentMap, name),
      ]);
    }

    if (effectiveKey && GHERKIN_KEYS.includes(effectiveKey)) {
      const caseNames = this.getCaseNamesForStepText(filesContentMap, name);
      return this.uniqueLocations([
        ...this.findStepReferences(filesContentMap, name),
        ...caseNames.flatMap((caseName) => this.findCaseReferences(filesContentMap, caseName)),
      ]);
    }

    if (effectiveKey === "Environment" || listParentKey === "Inherit") {
      return this.findEnvironmentReferences(filesContentMap, name);
    }

    if (effectiveKey === "App" || effectiveKey === "app") {
      return this.findAppReferences(filesContentMap, name);
    }

    if (effectiveKey === "Role" || effectiveKey === "role") {
      return this.findRoleReferences(filesContentMap, name);
    }

    return [];
  }

  private isFrameworkReferenceContext(
    document: vscode.TextDocument,
    position: vscode.Position
  ): boolean {
    const currentKey = this.getCurrentKey(document, position);
    const listParentKey = this.getListParentKey(document, position);
    const line = document.lineAt(position.line).text;
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;
    const fullLineKey = line.trimStart().match(/^-?\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:/)?.[1];
    const effectiveKey = currentKey ?? fullLineKey;

    if (
      (effectiveKey === "Value" && this.isCaseValueContext(document, position)) ||
      effectiveKey === "Case" ||
      effectiveKey === "Step" ||
      effectiveKey === "Environment" ||
      effectiveKey === "App" ||
      effectiveKey === "app" ||
      effectiveKey === "Role" ||
      effectiveKey === "role" ||
      listParentKey === "Precases" ||
      listParentKey === "Aftercases" ||
      listParentKey === "Inherit" ||
      (effectiveKey && GHERKIN_KEYS.includes(effectiveKey))
    ) {
      return true;
    }

    const topDef = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
    if (indent === 0 && topDef && !ROOT_NON_CASE_KEYS.has(topDef[1])) {
      const start = line.indexOf(topDef[1]);
      const end = start + topDef[1].length;
      return position.character >= start && position.character <= end;
    }

    return false;
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
          const match = trimmed.match(new RegExp(`^-?\\s*${key}\\s*:\\s*(.+)$`));
          if (match && this.normalizeValue(match[1]) === stepName) {
            locations.push(this.createLocationFromFilePathAndLineNumber(filePath, index + 1));
            return;
          }
        }
      });
    });
    return locations;
  }

  private findStepReferencesByCaseName(
    filesContentMap: FilesContentMap,
    caseName: string
  ): vscode.Location[] {
    const stepTexts = this.getStepTextsForCaseName(filesContentMap, caseName);
    return this.uniqueLocations(
      stepTexts.flatMap((stepText) => this.findStepReferences(filesContentMap, stepText))
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
        if (stepMatch && this.normalizeValue(stepMatch[1]) === stepText) {
          names.add(currentCaseName);
        }
      });
    });
    return [...names];
  }

  private getStepTextsForCaseName(
    filesContentMap: FilesContentMap,
    caseName: string
  ): string[] {
    const steps = new Set<string>();
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
        if (currentCaseName !== caseName) {
          return;
        }
        const stepMatch = trimmed.match(/^Step\s*:\s*(.+)$/);
        if (stepMatch) {
          const stepText = this.normalizeValue(stepMatch[1]);
          if (stepText) {
            steps.add(stepText);
          }
        }
      });
    });
    return [...steps];
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

  private isCaseDefinitionCursor(
    document: vscode.TextDocument,
    position: vscode.Position,
    name: string
  ): boolean {
    const line = document.lineAt(position.line).text;
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;
    const topDef = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
    if (!topDef || indent !== 0 || ROOT_NON_CASE_KEYS.has(topDef[1]) || topDef[1] !== name) {
      return false;
    }
    const start = line.indexOf(topDef[1]);
    const end = start + topDef[1].length;
    return position.character >= start && position.character <= end;
  }

  private isStepDefinitionCursor(
    document: vscode.TextDocument,
    position: vscode.Position,
    stepText: string
  ): boolean {
    const line = document.lineAt(position.line).text;
    const m = line.trim().match(/^Step\s*:\s*(.+)$/);
    if (!m) {
      return false;
    }
    const colon = line.indexOf(":");
    return position.character > colon && this.normalizeValue(m[1]) === stepText;
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
}
