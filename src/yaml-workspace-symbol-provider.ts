import * as path from "path";
import * as vscode from "vscode";
import { getFilesContentMap } from "./core/get-files-content-map";
import { getWorkspaceRoot } from "./utils/get-workspace-root";
import { ROOT_NON_CASE_KEYS } from "./yaml-framework-context";

export class YamlWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
  provideWorkspaceSymbols(query: string): vscode.SymbolInformation[] {
    const filesContentMap = getFilesContentMap(getWorkspaceRoot());
    const symbols: vscode.SymbolInformation[] = [];
    const search = query.trim().toLowerCase();

    Object.entries(filesContentMap).forEach(([filePath, lines]) => {
      let inEnvironments = false;
      let environmentsIndent = 0;
      let inApps = false;
      let appsIndent = 0;
      const uri = vscode.Uri.file(filePath);

      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          return;
        }
        const indent = line.length - line.trimStart().length;

        if (!inEnvironments && /^Environments\s*:\s*$/.test(trimmed)) {
          inEnvironments = true;
          environmentsIndent = indent;
          return;
        }
        if (inEnvironments && indent <= environmentsIndent && trimmed.length > 0) {
          inEnvironments = false;
        }

        if (!inApps && /^Apps\s*:\s*$/.test(trimmed)) {
          inApps = true;
          appsIndent = indent;
          return;
        }
        if (inApps && indent <= appsIndent && trimmed.length > 0) {
          inApps = false;
        }

        const top = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
        if (top && indent === 0 && !ROOT_NON_CASE_KEYS.has(top[1])) {
          if (!search || top[1].toLowerCase().includes(search)) {
            symbols.push(
              new vscode.SymbolInformation(
                top[1],
                vscode.SymbolKind.Function,
                "Case/Set",
                new vscode.Location(uri, new vscode.Position(index, 0))
              )
            );
          }
          return;
        }

        if (inEnvironments) {
          const env = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
          if (env && (!search || env[1].toLowerCase().includes(search))) {
            symbols.push(
              new vscode.SymbolInformation(
                env[1],
                vscode.SymbolKind.Namespace,
                "Environment",
                new vscode.Location(uri, new vscode.Position(index, 0))
              )
            );
          }
        }

        if (inApps) {
          const app = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
          if (app && indent === appsIndent + 2 && (!search || app[1].toLowerCase().includes(search))) {
            symbols.push(
              new vscode.SymbolInformation(
                app[1],
                vscode.SymbolKind.Class,
                "App",
                new vscode.Location(uri, new vscode.Position(index, 0))
              )
            );
          }
        }

        const role = trimmed.match(/^-?\s*role\s*:\s*(.+)$/);
        if (role) {
          role[1]
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
            .forEach((name) => {
              if (!search || name.toLowerCase().includes(search)) {
                symbols.push(
                  new vscode.SymbolInformation(
                    name,
                    vscode.SymbolKind.Variable,
                    "Role",
                    new vscode.Location(uri, new vscode.Position(index, 0))
                  )
                );
              }
            });
        }
      });
    });

    return symbols.sort((a, b) => a.name.localeCompare(b.name));
  }

  resolveWorkspaceSymbol(symbol: vscode.SymbolInformation): vscode.SymbolInformation {
    return symbol;
  }
}
