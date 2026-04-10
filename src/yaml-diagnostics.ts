import * as vscode from "vscode";
import {
  findIfCasesLineIndex,
  findRoleValueInAction,
  isTimerRoleValid,
  isValidLoopTimesValue,
  parseLoopCaseName,
  parseLoopTimesRaw,
  validateIfCasesListItems,
} from "./core/control-flow-action-validation";
import {
  findFailCaseLineIndex,
  isContinueOnFailBooleanLike,
  parseFailCaseChildren,
  resolveFailCaseValueName,
} from "./core/fail-case-validation";
import { collectCaseDefinitionSites } from "./core/duplicate-case-definitions";
import { FilesContentMap, getFilesContentMap } from "./core/get-files-content-map";
import { getWorkspaceRoot } from "./utils/get-workspace-root";
import { ILogger } from "./utils/logger";
import {
  getParentCollectionKey,
  isUnderCasesCollection,
  normalizeFrameworkValue,
  previousActionTypeIsCase,
  ROOT_NON_CASE_KEYS,
} from "./yaml-framework-context";

type ActionRule = {
  requiredKeys: string[];
};

const ACTION_RULES: Record<string, ActionRule> = {
  click: { requiredKeys: ["Strategy", "Id"] },
  navigate: { requiredKeys: ["Value"] },
  command: { requiredKeys: ["Value"] },
  sleep: { requiredKeys: ["Time"] },
  case: { requiredKeys: ["Value"] },
  get_call: { requiredKeys: ["Url"] },
  post_call: { requiredKeys: ["Url"] },
  assert: { requiredKeys: ["Asserts"] },
  launch_app: { requiredKeys: ["Value"] },
  terminate_app: { requiredKeys: ["Value"] },
  if: { requiredKeys: ["If_Cases"] },
  loop: { requiredKeys: ["Case", "Times"] },
  sync: { requiredKeys: [] },
  timer: { requiredKeys: ["Role"] },
};

const GHERKIN_PREFIXES = ["Given", "Then", "And", "But", "When"];

type ParsedAction = {
  startLine: number;
  endLine: number;
  typeValue: string | undefined;
  typeLine: number | undefined;
  keys: Set<string>;
};

type FrameworkIndex = {
  caseDefinitions: Set<string>;
  environmentDefinitions: Set<string>;
  roleDefinitions: Set<string>;
  roleVarsMap: Map<string, Set<string>>;
  caseReferenceCount: Map<string, number>;
  environmentReferenceCount: Map<string, number>;
  roleReferenceCount: Map<string, number>;
};
const CLI_VAR_PATTERN = /^\$AND_CLI_([A-Za-z0-9_]+)\$$/;

function getIndentation(line: string): number {
  return line.length - line.trimStart().length;
}

function parseKeyValue(line: string): { key: string; value: string } | undefined {
  const trimmed = line.trim();
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
  if (!match) {
    return undefined;
  }

  const [, key, value] = match;
  return { key, value };
}

function parseActionTypeLine(line: string): string | undefined {
  const match = line.trim().match(/^-+\s+Type\s*:\s*(.+)$/);
  if (!match) {
    return undefined;
  }

  return match[1].trim();
}

function parseInlineActionKeyValue(line: string): { key: string; value: string } | undefined {
  const trimmed = line.trim();
  const match = trimmed.match(/^-+\s+([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
  if (!match) {
    return undefined;
  }

  const [, key, value] = match;
  return { key, value };
}

function isYamlDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "yaml";
}

function increaseCount(counter: Map<string, number>, name: string) {
  counter.set(name, (counter.get(name) ?? 0) + 1);
}

function isCliVar(name: string): boolean {
  return CLI_VAR_PATTERN.test(name);
}

function isMainRoleVar(name: string): boolean {
  return name === "$AND_CLI_MAINROLE$";
}

function getCliVarName(name: string): string {
  const match = name.match(CLI_VAR_PATTERN);
  return match?.[1] ?? name;
}

function isInsideVarsSection(lines: FileContentLine[], lineIndex: number): boolean {
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

function buildFrameworkIndex(filesContentMap: FilesContentMap): FrameworkIndex {
  const caseDefinitions = new Set<string>();
  const environmentDefinitions = new Set<string>();
  const roleDefinitions = new Set<string>();
  const roleVarsMap = new Map<string, Set<string>>();
  const caseReferenceCount = new Map<string, number>();
  const environmentReferenceCount = new Map<string, number>();
  const roleReferenceCount = new Map<string, number>();
  const pendingRoleRefs: string[] = [];

  Object.values(filesContentMap).forEach((lines) => {
    let inEnvironments = false;
    let environmentsIndent = 0;

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return;
      }

      const indent = getIndentation(line);

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

      const topDef = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
      if (topDef && indent === 0 && !ROOT_NON_CASE_KEYS.has(topDef[1])) {
        caseDefinitions.add(topDef[1]);
      }

      if (inEnvironments) {
        const envDef = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
        if (envDef) {
          environmentDefinitions.add(envDef[1]);
        }
      }

      const valueCaseRef = trimmed.match(/^Value\s*:\s*(.+)$/);
      if (valueCaseRef) {
        const value = normalizeFrameworkValue(valueCaseRef[1]);
        if (previousActionTypeIsCase(lines, index, indent)) {
          increaseCount(caseReferenceCount, value);
        }
      }

      const listRef = trimmed.match(/^-\s*(.+)$/);
      if (listRef) {
        const value = normalizeFrameworkValue(listRef[1]);
        const parent = getParentCollectionKey(lines, index, indent);
        if (parent === "Precases" || parent === "Aftercases") {
          increaseCount(caseReferenceCount, value);
        }
        if (parent === "Inherit") {
          increaseCount(environmentReferenceCount, value);
        }
      }

      const setCase = trimmed.match(/^Case\s*:\s*(.+)$/);
      if (setCase && isUnderCasesCollection(lines, index, indent)) {
        increaseCount(caseReferenceCount, normalizeFrameworkValue(setCase[1]));
      }

      const envRef = trimmed.match(/^Environment\s*:\s*(.+)$/);
      if (envRef) {
        increaseCount(environmentReferenceCount, normalizeFrameworkValue(envRef[1]));
      }

      const roleDef = trimmed.match(/^-?\s*role\s*:\s*(.+)$/);
      if (roleDef) {
        normalizeFrameworkValue(roleDef[1])
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .forEach((value) => roleDefinitions.add(value));
      }

      const varDef = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
      if (varDef && isInsideVarsSection(lines, index)) {
        const key = varDef[1];
        const value = normalizeFrameworkValue(varDef[2]);
        const existing = roleVarsMap.get(key) ?? new Set<string>();
        value
          .split(",")
          .map((part) => normalizeFrameworkValue(part))
          .filter(Boolean)
          .forEach((part) => existing.add(part));
        roleVarsMap.set(key, existing);
      }

      const roleRef = trimmed.match(/^Role\s*:\s*(.+)$/);
      if (roleRef) {
        normalizeFrameworkValue(roleRef[1])
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .forEach((value) => pendingRoleRefs.push(value));
      }
    });
  });

  pendingRoleRefs.forEach((value) => {
    if (!isCliVar(value)) {
      increaseCount(roleReferenceCount, value);
      return;
    }
    if (isMainRoleVar(value)) {
      return;
    }
    const varName = getCliVarName(value);
    const resolved = roleVarsMap.get(varName);
    if (!resolved) {
      return;
    }
    [...resolved].forEach((resolvedRole) => increaseCount(roleReferenceCount, resolvedRole));
  });

  return {
    caseDefinitions,
    environmentDefinitions,
    roleDefinitions,
    roleVarsMap,
    caseReferenceCount,
    environmentReferenceCount,
    roleReferenceCount,
  };
}

export class YamlDiagnostics {
  constructor(
    private collection: vscode.DiagnosticCollection,
    private logger?: ILogger
  ) {}

  refreshDocument(document: vscode.TextDocument) {
    if (!isYamlDocument(document)) {
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    const filesContentMap = getFilesContentMap(getWorkspaceRoot());
    const index = buildFrameworkIndex(filesContentMap);
    const actions = this.parseActions(document);

    actions.forEach((action) => {
      const actionType = action.typeValue;
      if (!actionType) {
        const range = new vscode.Range(
          new vscode.Position(action.startLine, 0),
          new vscode.Position(action.startLine, document.lineAt(action.startLine).text.length)
        );
        diagnostics.push(
          Object.assign(
            new vscode.Diagnostic(
              range,
              "Action is missing `Type`.",
              vscode.DiagnosticSeverity.Error
            ),
            { code: "yaml-framework:missing-type" }
          )
        );
        return;
      }

      const rule = ACTION_RULES[actionType];
      if (!rule) {
        // TestRay allows custom actions via device methods, so unknown types are not invalid.
        return;
      }

      rule.requiredKeys.forEach((requiredKey) => {
        if (action.keys.has(requiredKey)) {
          return;
        }

        const line = action.typeLine ?? action.startLine;
        const typeRange = this.getTypeRange(document, line, actionType);
        diagnostics.push(
          Object.assign(
            new vscode.Diagnostic(
              typeRange,
              `Action type \`${actionType}\` is missing required key \`${requiredKey}\`.`,
              vscode.DiagnosticSeverity.Error
            ),
            {
              code: `yaml-framework:missing-required-key:${actionType}:${requiredKey}`,
            }
          )
        );
      });
    });

    this.addControlFlowDiagnostics(document, diagnostics, index, actions);
    this.addFailCaseDiagnostics(document, diagnostics, index, actions);

    this.addReferenceDiagnostics(document, diagnostics, index);
    this.addUnusedDiagnostics(document, diagnostics, index);
    this.addDuplicateCaseDiagnostics(document, diagnostics, filesContentMap);

    this.logger?.log("Diagnostics count:", diagnostics.length, document.fileName);
    this.collection.set(document.uri, diagnostics);
  }

  async refreshWorkspace() {
    const files = await vscode.workspace.findFiles("**/*.y?(a)ml", "**/node_modules/**");
    for (const file of files) {
      const document = await vscode.workspace.openTextDocument(file);
      this.refreshDocument(document);
    }
  }

  clearDocument(uri: vscode.Uri) {
    this.collection.delete(uri);
  }

  private addControlFlowDiagnostics(
    document: vscode.TextDocument,
    diagnostics: vscode.Diagnostic[],
    index: FrameworkIndex,
    actions: ParsedAction[]
  ) {
    const allLines = Array.from({ length: document.lineCount }, (_, i) => document.lineAt(i).text);

    actions.forEach((action) => {
      const type = action.typeValue;
      if (!type) {
        return;
      }

      const actionLines = allLines.slice(action.startLine, action.endLine + 1);

      if (type === "timer") {
        if (!action.keys.has("Role")) {
          return;
        }
        const role = findRoleValueInAction(actionLines);
        if (!isTimerRoleValid(role)) {
          const line = action.typeLine ?? action.startLine;
          diagnostics.push(
            Object.assign(
              new vscode.Diagnostic(
                this.getTypeRange(document, line, "timer"),
                role === undefined || role === ""
                  ? "`Type: timer` requires `Role: start` or `Role: end` (TestRay `timer_handler`)."
                  : `\`Role\` for timer must be \`start\` or \`end\`, not \`${role}\`.`,
                vscode.DiagnosticSeverity.Error
              ),
              { code: "yaml-framework:timer-invalid-role" }
            )
          );
        }
        return;
      }

      if (type === "loop") {
        if (action.keys.has("Times")) {
          const timesRaw = parseLoopTimesRaw(actionLines);
          if (!isValidLoopTimesValue(timesRaw)) {
            const timesLine = this.findKeyLineInAction(actionLines, action.startLine, "Times");
            const range = timesLine !== undefined
              ? this.fullLineRange(document, timesLine)
              : this.fullLineRange(document, action.typeLine ?? action.startLine);
            diagnostics.push(
              Object.assign(
                new vscode.Diagnostic(
                  range,
                  "`Times` for `Type: loop` must be a non-negative integer (TestRay `loop_handler`).",
                  vscode.DiagnosticSeverity.Error
                ),
                { code: "yaml-framework:loop-invalid-times" }
              )
            );
          }
        }

        const loopCase = parseLoopCaseName(actionLines);
        if (loopCase && !index.caseDefinitions.has(loopCase)) {
          const caseLine = this.findKeyLineInAction(actionLines, action.startLine, "Case");
          const range =
            caseLine !== undefined
              ? this.valueRange(document.lineAt(caseLine).text, caseLine)
              : this.fullLineRange(document, action.typeLine ?? action.startLine);
          diagnostics.push(
            Object.assign(
              new vscode.Diagnostic(
                range,
                `Loop target case \`${loopCase}\` is not defined.`,
                vscode.DiagnosticSeverity.Warning
              ),
              { code: `yaml-framework:missing-case:${loopCase}` }
            )
          );
        }
        return;
      }

      if (type === "if") {
        if (!action.keys.has("If_Cases")) {
          return;
        }
        const ifIdx = findIfCasesLineIndex(actionLines);
        if (ifIdx < 0) {
          return;
        }
        validateIfCasesListItems(actionLines, ifIdx).forEach((issue) => {
          const line = action.startLine + issue.itemStartLine;
          diagnostics.push(
            Object.assign(
              new vscode.Diagnostic(
                this.fullLineRange(document, line),
                issue.message,
                vscode.DiagnosticSeverity.Error
              ),
              { code: "yaml-framework:if-missing-if-case" }
            )
          );
        });
      }
    });
  }

  private addFailCaseDiagnostics(
    document: vscode.TextDocument,
    diagnostics: vscode.Diagnostic[],
    index: FrameworkIndex,
    actions: ParsedAction[]
  ) {
    const allLines = Array.from({ length: document.lineCount }, (_, i) => document.lineAt(i).text);

    actions.forEach((action) => {
      if (!action.keys.has("FailCase")) {
        return;
      }

      const actionLines = allLines.slice(action.startLine, action.endLine + 1);
      const failIdx = findFailCaseLineIndex(actionLines);
      if (failIdx < 0) {
        return;
      }

      const children = parseFailCaseChildren(actionLines, failIdx);
      const failCaseHeaderLine = action.startLine + failIdx;
      const valueEntry = children.get("Value");

      if (!valueEntry) {
        diagnostics.push(
          Object.assign(
            new vscode.Diagnostic(
              this.fullLineRange(document, failCaseHeaderLine),
              "FailCase must include `Value` (TestRay runs `action[\"FailCase\"][\"Value\"]` on error).",
              vscode.DiagnosticSeverity.Error
            ),
            { code: "yaml-framework:failcase-missing-value" }
          )
        );
        return;
      }

      const caseName = resolveFailCaseValueName(valueEntry, actionLines);
      const valueLine = action.startLine + valueEntry.relativeLine;

      if (!caseName) {
        diagnostics.push(
          Object.assign(
            new vscode.Diagnostic(
              this.fullLineRange(document, valueLine),
              "FailCase `Value` must name a case to run (non-empty).",
              vscode.DiagnosticSeverity.Error
            ),
            { code: "yaml-framework:failcase-empty-value" }
          )
        );
        return;
      }

      if (!index.caseDefinitions.has(caseName)) {
        diagnostics.push(
          Object.assign(
            new vscode.Diagnostic(
              this.valueRange(document.lineAt(valueLine).text, valueLine),
              `FailCase target case \`${caseName}\` is not defined.`,
              vscode.DiagnosticSeverity.Warning
            ),
            { code: `yaml-framework:missing-case:${caseName}` }
          )
        );
      }

      const cof = children.get("ContinueOnFail");
      if (cof && !isContinueOnFailBooleanLike(cof.valueRaw)) {
        const cofLine = action.startLine + cof.relativeLine;
        diagnostics.push(
          Object.assign(
            new vscode.Diagnostic(
              this.fullLineRange(document, cofLine),
              "`ContinueOnFail` should be `true` or `false` (TestRay only continues when it is truthy).",
              vscode.DiagnosticSeverity.Warning
            ),
            { code: "yaml-framework:failcase-invalid-continue-on-fail" }
          )
        );
      }
    });
  }

  private findKeyLineInAction(
    actionLines: string[],
    actionStartLine: number,
    key: string
  ): number | undefined {
    const re = new RegExp(`^\\s*${key}\\s*:`);
    for (let i = 0; i < actionLines.length; i += 1) {
      if (re.test(actionLines[i] ?? "")) {
        return actionStartLine + i;
      }
    }
    return undefined;
  }

  private fullLineRange(document: vscode.TextDocument, line: number): vscode.Range {
    const text = document.lineAt(line).text;
    return new vscode.Range(line, 0, line, text.length);
  }

  private getTypeRange(
    document: vscode.TextDocument,
    line: number,
    actionType: string
  ): vscode.Range {
    const text = document.lineAt(line).text;
    const start = Math.max(0, text.indexOf(actionType));

    return new vscode.Range(
      new vscode.Position(line, start),
      new vscode.Position(line, start + actionType.length)
    );
  }

  private parseActions(document: vscode.TextDocument): ParsedAction[] {
    const actions: ParsedAction[] = [];
    const lines = Array.from({ length: document.lineCount }, (_, i) => document.lineAt(i).text);

    let inActions = false;
    let actionsIndent = 0;
    let actionItemIndent: number | undefined;
    let currentAction: ParsedAction | undefined;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const trimmed = line.trim();

      if (trimmed.length === 0 || trimmed.startsWith("#")) {
        continue;
      }

      const indent = getIndentation(line);

      if (!inActions) {
        if (/^Actions\s*:\s*$/.test(trimmed)) {
          inActions = true;
          actionsIndent = indent;
          actionItemIndent = undefined;
          currentAction = undefined;
        }
        continue;
      }

      if (indent <= actionsIndent) {
        inActions = false;
        actionItemIndent = undefined;
        currentAction = undefined;

        if (/^Actions\s*:\s*$/.test(trimmed)) {
          inActions = true;
          actionsIndent = indent;
          actionItemIndent = undefined;
        }
        continue;
      }

      if (actionItemIndent === undefined && trimmed.startsWith("- ")) {
        actionItemIndent = indent;
      }

      const isTopLevelActionLine =
        actionItemIndent !== undefined &&
        indent === actionItemIndent &&
        trimmed.startsWith("- ");

      if (!isTopLevelActionLine) {
        if (!currentAction) {
          continue;
        }

        const parsedNested = parseKeyValue(line);
        if (parsedNested) {
          currentAction.keys.add(parsedNested.key);
        }
        currentAction.endLine = lineIndex;
        continue;
      }

      const typeValue = parseActionTypeLine(line);
      if (typeValue !== undefined) {
        if (currentAction) {
          currentAction.endLine = lineIndex - 1;
          actions.push(currentAction);
        }

        currentAction = {
          startLine: lineIndex,
          endLine: lineIndex,
          typeValue,
          typeLine: lineIndex,
          keys: new Set(["Type"]),
        };
        continue;
      }

      const inlineAction = parseInlineActionKeyValue(line);
      if (inlineAction && GHERKIN_PREFIXES.includes(inlineAction.key)) {
        if (currentAction) {
          currentAction.endLine = lineIndex - 1;
          actions.push(currentAction);
        }

        currentAction = {
          startLine: lineIndex,
          endLine: lineIndex,
          typeValue: "case",
          typeLine: lineIndex,
          keys: new Set(["Type", "Value", inlineAction.key]),
        };
        continue;
      }

      if (currentAction) {
        currentAction.endLine = lineIndex - 1;
        actions.push(currentAction);
      }

      currentAction = {
        startLine: lineIndex,
        endLine: lineIndex,
        typeValue: undefined,
        typeLine: undefined,
        keys: new Set(),
      };

      if (!currentAction) {
        continue;
      }

      const parsed = parseKeyValue(line);
      if (parsed) {
        currentAction.keys.add(parsed.key);
      }
      currentAction.endLine = lineIndex;
    }

    if (currentAction) {
      actions.push(currentAction);
    }

    return actions;
  }

  private addReferenceDiagnostics(
    document: vscode.TextDocument,
    diagnostics: vscode.Diagnostic[],
    index: FrameworkIndex
  ) {
    const lines = Array.from({ length: document.lineCount }, (_, i) => document.lineAt(i).text);

    lines.forEach((line, lineIndex) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return;
      }
      const indent = getIndentation(line);

      const valueCaseRef = trimmed.match(/^Value\s*:\s*(.+)$/);
      if (valueCaseRef && previousActionTypeIsCase(lines, lineIndex, indent)) {
        const caseName = normalizeFrameworkValue(valueCaseRef[1]);
        if (!index.caseDefinitions.has(caseName)) {
          diagnostics.push(
            Object.assign(
              new vscode.Diagnostic(
                this.valueRange(line, lineIndex),
                `Referenced case \`${caseName}\` is not defined.`,
                vscode.DiagnosticSeverity.Warning
              ),
              { code: `yaml-framework:missing-case:${caseName}` }
            )
          );
        }
      }

      const listRef = trimmed.match(/^-\s*(.+)$/);
      if (listRef) {
        const value = normalizeFrameworkValue(listRef[1]);
        const parent = getParentCollectionKey(lines, lineIndex, indent);
        if ((parent === "Precases" || parent === "Aftercases") && !index.caseDefinitions.has(value)) {
          diagnostics.push(
            Object.assign(
              new vscode.Diagnostic(
                this.valueRange(line, lineIndex),
                `Referenced case \`${value}\` is not defined.`,
                vscode.DiagnosticSeverity.Warning
              ),
              { code: `yaml-framework:missing-case:${value}` }
            )
          );
        }
        if (parent === "Inherit" && !index.environmentDefinitions.has(value)) {
          diagnostics.push(
            Object.assign(
              new vscode.Diagnostic(
                this.valueRange(line, lineIndex),
                `Referenced environment \`${value}\` is not defined.`,
                vscode.DiagnosticSeverity.Warning
              ),
              { code: `yaml-framework:missing-environment:${value}` }
            )
          );
        }
      }

      const setCase = trimmed.match(/^Case\s*:\s*(.+)$/);
      if (setCase && isUnderCasesCollection(lines, lineIndex, indent)) {
        const value = normalizeFrameworkValue(setCase[1]);
        if (!index.caseDefinitions.has(value)) {
          diagnostics.push(
            Object.assign(
              new vscode.Diagnostic(
                this.valueRange(line, lineIndex),
                `Referenced case \`${value}\` is not defined.`,
                vscode.DiagnosticSeverity.Warning
              ),
              { code: `yaml-framework:missing-case:${value}` }
            )
          );
        }
      }

      const envRef = trimmed.match(/^Environment\s*:\s*(.+)$/);
      if (envRef) {
        const value = normalizeFrameworkValue(envRef[1]);
        if (!index.environmentDefinitions.has(value)) {
          diagnostics.push(
            Object.assign(
              new vscode.Diagnostic(
                this.valueRange(line, lineIndex),
                `Referenced environment \`${value}\` is not defined.`,
                vscode.DiagnosticSeverity.Warning
              ),
              { code: `yaml-framework:missing-environment:${value}` }
            )
          );
        }
      }

      const roleRef = trimmed.match(/^Role\s*:\s*(.+)$/);
      if (roleRef) {
        normalizeFrameworkValue(roleRef[1])
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .forEach((value) => {
            if (isMainRoleVar(value)) {
              return;
            }
            if (isCliVar(value)) {
              const varName = getCliVarName(value);
              const resolvedRoles = index.roleVarsMap.get(varName);
              if (!resolvedRoles || resolvedRoles.size === 0) {
                // Variable can be provided by parent execution context; avoid false positives.
                return;
              }
              const unresolved = [...resolvedRoles].filter(
                (role) => !index.roleDefinitions.has(role)
              );
              if (unresolved.length === 0) {
                return;
              }
              unresolved.forEach((role) =>
                diagnostics.push(
                  Object.assign(
                    new vscode.Diagnostic(
                      this.valueRange(line, lineIndex),
                      `Role variable \`${value}\` resolves to undefined role \`${role}\`.`,
                      vscode.DiagnosticSeverity.Warning
                    ),
                    { code: `yaml-framework:missing-role:${role}` }
                  )
                )
              );
              return;
            }
            if (index.roleDefinitions.has(value)) {
              return;
            }
            diagnostics.push(
              Object.assign(
                new vscode.Diagnostic(
                  this.valueRange(line, lineIndex),
                  `Referenced role \`${value}\` is not defined in config.yaml.`,
                  vscode.DiagnosticSeverity.Warning
                ),
                { code: `yaml-framework:missing-role:${value}` }
              )
            );
          });
      }
    });
  }

  private addDuplicateCaseDiagnostics(
    document: vscode.TextDocument,
    diagnostics: vscode.Diagnostic[],
    filesContentMap: FilesContentMap
  ) {
    const groups = collectCaseDefinitionSites(filesContentMap);
    const docPath = document.uri.fsPath;

    groups.forEach((sites, caseName) => {
      if (sites.length < 2) {
        return;
      }

      sites.forEach((site) => {
        if (site.absolutePath !== docPath) {
          return;
        }

        const range = new vscode.Range(
          new vscode.Position(site.line, site.nameStart),
          new vscode.Position(site.line, site.nameEnd)
        );

        const others = sites.filter(
          (s) => !(s.absolutePath === site.absolutePath && s.line === site.line)
        );

        const message =
          sites.length === 2
            ? `Duplicate case name \`${caseName}\` is also defined elsewhere. TestRay aborts when the same case name appears more than once.`
            : `Duplicate case name \`${caseName}\` is defined ${sites.length} times. TestRay aborts when the same case name appears more than once.`;

        const diagnostic = Object.assign(
          new vscode.Diagnostic(
            range,
            message,
            vscode.DiagnosticSeverity.Error
          ),
          { code: `yaml-framework:duplicate-case-name:${caseName}` }
        );

        diagnostic.relatedInformation = others.map(
          (s) =>
            new vscode.DiagnosticRelatedInformation(
              new vscode.Location(
                vscode.Uri.file(s.absolutePath),
                new vscode.Range(
                  new vscode.Position(s.line, s.nameStart),
                  new vscode.Position(s.line, s.nameEnd)
                )
              ),
              "Other definition of this case name"
            )
        );

        diagnostics.push(diagnostic);
      });
    });
  }

  private addUnusedDiagnostics(
    document: vscode.TextDocument,
    diagnostics: vscode.Diagnostic[],
    index: FrameworkIndex
  ) {
    const lines = Array.from({ length: document.lineCount }, (_, i) => document.lineAt(i).text);
    let inEnvironments = false;
    let environmentsIndent = 0;

    lines.forEach((line, lineIndex) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return;
      }
      const indent = getIndentation(line);

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

      if (inEnvironments) {
        const envDef = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
        if (envDef) {
          const count = index.environmentReferenceCount.get(envDef[1]) ?? 0;
          if (count === 0) {
            diagnostics.push(
              new vscode.Diagnostic(
                this.valueRange(line, lineIndex),
                `Environment \`${envDef[1]}\` appears to be unused.`,
                vscode.DiagnosticSeverity.Information
              )
            );
          }
        }
      }

      const roleDef = trimmed.match(/^-?\s*role\s*:\s*(.+)$/);
      if (roleDef) {
        normalizeFrameworkValue(roleDef[1])
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .forEach((value) => {
            const count = index.roleReferenceCount.get(value) ?? 0;
            if (count > 0) {
              return;
            }
            diagnostics.push(
              new vscode.Diagnostic(
                this.valueRange(line, lineIndex),
                `Role \`${value}\` appears to be unused.`,
                vscode.DiagnosticSeverity.Information
              )
            );
          });
      }
    });
  }

  private valueRange(line: string, lineIndex: number): vscode.Range {
    const start = line.search(/\S/);
    return new vscode.Range(
      new vscode.Position(lineIndex, Math.max(0, start)),
      new vscode.Position(lineIndex, line.length)
    );
  }
}
