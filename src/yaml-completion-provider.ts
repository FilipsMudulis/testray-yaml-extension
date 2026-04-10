import * as vscode from "vscode";
import { getFilesContentMap } from "./core/get-files-content-map";
import {
  collectWorkspaceCliVarDefinitions,
  parseAndCliCompletionPrefix,
  sortedCliVarNameSuggestions,
} from "./core/vars-cli-and-greps";
import { getWorkspaceRoot } from "./utils/get-workspace-root";
import { ILogger } from "./utils/logger";

const ACTION_TYPES = [
  "assert",
  "case",
  "click",
  "command",
  "get_attribute",
  "get_call",
  "get_text",
  "get_url",
  "if",
  "launch_app",
  "loop",
  "navigate",
  "operation",
  "pause",
  "post_call",
  "screenshot",
  "send_keys",
  "sleep",
  "swipe_coord",
  "sync",
  "terminate_app",
  "timer",
  "wait_for",
];

const CONDITION_OPERATIONS = [
  "contain",
  "eq",
  "ge",
  "gt",
  "le",
  "lt",
  "n_contain",
  "n_eq",
  "ne",
  "visible",
  "visible_for",
];

const ASSERT_TYPES = ["code", "contain", "eq", "ge", "gt", "le", "lt", "n_contain", "n_eq", "ne"];

function getIndentation(line: string): number {
  return line.length - line.trimStart().length;
}

function parseValue(raw: string): string {
  return raw.replace(/^['"]|['"]$/g, "").trim();
}

function getCurrentKey(linePrefix: string): string | undefined {
  const trimmed = linePrefix.trimStart();
  const keyMatch = trimmed.match(/^-?\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
  return keyMatch?.[1];
}

type SymbolIndex = {
  caseNames: string[];
  environmentNames: string[];
  roleNames: string[];
};

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

export class YamlCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private logger?: ILogger) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    if (document.languageId !== "yaml") {
      return [];
    }

    const linePrefix = document.lineAt(position).text.slice(0, position.character);
    const cliPrefix = parseAndCliCompletionPrefix(linePrefix);
    if (cliPrefix) {
      const { varsValues, grepVarNames } = collectWorkspaceCliVarDefinitions(
        getFilesContentMap(getWorkspaceRoot())
      );
      const names = sortedCliVarNameSuggestions(varsValues, grepVarNames, cliPrefix.partial);
      const replaceRange = new vscode.Range(
        position.line,
        cliPrefix.replaceStart,
        position.line,
        position.character
      );
      return names.map((name) => {
        const insert = `$AND_CLI_${name}$`;
        const item = new vscode.CompletionItem(insert, vscode.CompletionItemKind.Variable);
        item.insertText = insert;
        item.range = replaceRange;
        item.filterText = insert;
        const literals = varsValues.get(name);
        if (literals && literals.size > 0) {
          item.detail = `Vars: ${[...literals].join(" | ")}`;
        } else if (grepVarNames.has(name)) {
          item.detail = "Greps (runtime)";
        }
        return item;
      });
    }

    const key = getCurrentKey(linePrefix);
    const index = this.buildSymbolIndex();

    if (!key) {
      return [];
    }

    if (key === "Type") {
      return ACTION_TYPES.map((value) => this.createItem(value, vscode.CompletionItemKind.EnumMember));
    }

    if (key === "Operation") {
      return CONDITION_OPERATIONS.map((value) =>
        this.createItem(value, vscode.CompletionItemKind.EnumMember)
      );
    }

    if (key === "Environment") {
      return index.environmentNames.map((value) =>
        this.createItem(value, vscode.CompletionItemKind.Variable)
      );
    }

    if (key === "Role") {
      return index.roleNames.map((value) => this.createItem(value, vscode.CompletionItemKind.Variable));
    }

    if (key === "Value" && this.isCaseValueContext(document, position)) {
      return index.caseNames.map((value) => this.createItem(value, vscode.CompletionItemKind.Reference));
    }

    if (this.isInheritItemContext(document, position)) {
      return index.environmentNames.map((value) =>
        this.createItem(value, vscode.CompletionItemKind.Variable)
      );
    }

    if (this.isSetCaseItemContext(document, position)) {
      return index.caseNames.map((value) => this.createItem(value, vscode.CompletionItemKind.Reference));
    }

    return [];
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
        return parseValue(typeMatch[1]) === "case";
      }
    }

    return false;
  }

  private isInheritItemContext(document: vscode.TextDocument, position: vscode.Position): boolean {
    const current = document.lineAt(position).text.slice(0, position.character).trimStart();
    if (!current.startsWith("-")) {
      return false;
    }

    const currentIndent = getIndentation(document.lineAt(position).text);
    for (let line = position.line - 1; line >= 0; line -= 1) {
      const text = document.lineAt(line).text;
      const trimmed = text.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#")) {
        continue;
      }

      const indent = getIndentation(text);
      if (indent < currentIndent) {
        return /^Inherit\s*:\s*$/.test(trimmed);
      }
    }

    return false;
  }

  private isSetCaseItemContext(document: vscode.TextDocument, position: vscode.Position): boolean {
    const key = getCurrentKey(document.lineAt(position).text.slice(0, position.character));
    if (key !== "Case") {
      return false;
    }

    const currentIndent = getIndentation(document.lineAt(position).text);
    for (let line = position.line - 1; line >= 0; line -= 1) {
      const text = document.lineAt(line).text;
      const trimmed = text.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#")) {
        continue;
      }

      const indent = getIndentation(text);
      if (indent < currentIndent) {
        return /^Cases\s*:\s*$/.test(trimmed);
      }
    }

    return false;
  }

  private createItem(label: string, kind: vscode.CompletionItemKind): vscode.CompletionItem {
    const item = new vscode.CompletionItem(label, kind);
    item.insertText = label;
    return item;
  }

  private buildSymbolIndex(): SymbolIndex {
    const root = getWorkspaceRoot();
    const filesContentMap = getFilesContentMap(root);

    const caseNames = new Set<string>();
    const environmentNames = new Set<string>();
    const roleNames = new Set<string>();

    Object.values(filesContentMap).forEach((lines) => {
      let inEnvironments = false;
      let environmentsIndent = 0;

      lines.forEach((line) => {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith("#")) {
          return;
        }

        const indent = getIndentation(line);

        if (!inEnvironments && /^Environments\s*:\s*$/.test(trimmed)) {
          inEnvironments = true;
          environmentsIndent = indent;
          return;
        }

        if (inEnvironments && indent <= environmentsIndent) {
          inEnvironments = false;
        }

        if (inEnvironments) {
          const envMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
          if (envMatch) {
            environmentNames.add(envMatch[1]);
          }
        }

        const roleMatch = trimmed.match(/^Role\s*:\s*(.+)$/);
        if (roleMatch) {
          parseValue(roleMatch[1])
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
            .forEach((value) => roleNames.add(value));
        }

        if (indent === 0) {
          const topLevelMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
          if (topLevelMatch) {
            const name = topLevelMatch[1];
            if (!["Apps", "Devices", "Environments", "Timeout", "chromeDriverPath"].includes(name)) {
              caseNames.add(name);
            }
          }
        }
      });
    });

    this.logger?.log("Completion index sizes", caseNames.size, environmentNames.size, roleNames.size);
    return {
      caseNames: uniqueSorted(caseNames),
      environmentNames: uniqueSorted(environmentNames),
      roleNames: uniqueSorted(roleNames),
    };
  }
}
