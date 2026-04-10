import * as vscode from "vscode";
import { getFilesContentMap } from "./core/get-files-content-map";
import { getWorkspaceRoot } from "./utils/get-workspace-root";
import { ROOT_NON_CASE_KEYS } from "./yaml-framework-context";
import {
  getParentCollectionKey,
  isUnderCasesCollection,
  normalizeFrameworkValue,
  previousActionTypeIsCase,
} from "./yaml-framework-context";

function getRangeForLine(document: vscode.TextDocument, line: number): vscode.Range {
  const text = document.lineAt(line).text;
  return new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, text.length));
}

export class YamlDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    if (document.languageId !== "yaml") {
      return [];
    }

    const caseReferenceCounts = this.getCaseReferenceCounts();
    const cases: vscode.DocumentSymbol[] = [];
    const environments: vscode.DocumentSymbol[] = [];
    const roles: vscode.DocumentSymbol[] = [];

    let inEnvironments = false;
    let environmentsIndent = 0;

    for (let i = 0; i < document.lineCount; i += 1) {
      const line = document.lineAt(i).text;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const indent = line.length - line.trimStart().length;

      if (!inEnvironments && /^Environments\s*:\s*$/.test(trimmed)) {
        inEnvironments = true;
        environmentsIndent = indent;
        continue;
      }

      if (inEnvironments && indent <= environmentsIndent && trimmed.length > 0) {
        inEnvironments = false;
      }

      const top = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
      if (top && indent === 0 && !ROOT_NON_CASE_KEYS.has(top[1])) {
        const count = caseReferenceCounts.get(top[1]) ?? 0;
        const label = count === 0 ? `★ ${top[1]}` : top[1];
        cases.push(
          new vscode.DocumentSymbol(
            label,
            count === 0 ? "Case/Set (no references)" : "Case/Set",
            vscode.SymbolKind.Function,
            getRangeForLine(document, i),
            getRangeForLine(document, i)
          )
        );
        continue;
      }

      if (inEnvironments) {
        const env = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
        if (env) {
          environments.push(
            new vscode.DocumentSymbol(
              env[1],
              "Environment",
              vscode.SymbolKind.Namespace,
              getRangeForLine(document, i),
              getRangeForLine(document, i)
            )
          );
          continue;
        }
      }

      const role = trimmed.match(/^(Role|role)\s*:\s*(.+)$/);
      if (role) {
        role[2]
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
          .forEach((roleName) => {
            roles.push(
              new vscode.DocumentSymbol(
                roleName,
                "Role",
                vscode.SymbolKind.Variable,
                getRangeForLine(document, i),
                getRangeForLine(document, i)
              )
            );
          });
      }
    }

    const roots: vscode.DocumentSymbol[] = [];
    if (cases.length > 0) {
      const root = new vscode.DocumentSymbol(
        "Cases",
        "Top-level case/set definitions",
        vscode.SymbolKind.Module,
        cases[0].range,
        cases[0].selectionRange
      );
      root.children = cases;
      roots.push(root);
    }
    if (environments.length > 0) {
      const root = new vscode.DocumentSymbol(
        "Environments",
        "Environment definitions",
        vscode.SymbolKind.Module,
        environments[0].range,
        environments[0].selectionRange
      );
      root.children = environments;
      roots.push(root);
    }
    if (roles.length > 0) {
      const root = new vscode.DocumentSymbol(
        "Roles",
        "Role declarations/usages",
        vscode.SymbolKind.Module,
        roles[0].range,
        roles[0].selectionRange
      );
      root.children = roles;
      roots.push(root);
    }

    return roots;
  }

  private getCaseReferenceCounts(): Map<string, number> {
    const filesContentMap = getFilesContentMap(getWorkspaceRoot());
    const counts = new Map<string, number>();

    Object.values(filesContentMap).forEach((lines) => {
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          return;
        }
        const indent = line.length - line.trimStart().length;

        const typeCaseValueMatch = trimmed.match(/^Value\s*:\s*(.+)$/);
        if (typeCaseValueMatch && previousActionTypeIsCase(lines, index, indent)) {
          const value = normalizeFrameworkValue(typeCaseValueMatch[1]);
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }

        const listItemMatch = trimmed.match(/^-\s*(.+)$/);
        if (listItemMatch) {
          const value = normalizeFrameworkValue(listItemMatch[1]);
          const parent = getParentCollectionKey(lines, index, indent);
          if (parent === "Precases" || parent === "Aftercases") {
            counts.set(value, (counts.get(value) ?? 0) + 1);
          }
        }

        const setCaseMatch = trimmed.match(/^Case\s*:\s*(.+)$/);
        if (setCaseMatch && isUnderCasesCollection(lines, index, indent)) {
          const value = normalizeFrameworkValue(setCaseMatch[1]);
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }
      });
    });

    return counts;
  }
}
