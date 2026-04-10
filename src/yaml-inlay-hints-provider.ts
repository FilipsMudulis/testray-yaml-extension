import * as vscode from "vscode";
import { getFilesContentMap } from "./core/get-files-content-map";
import { getWorkspaceRoot } from "./utils/get-workspace-root";
import { normalizeFrameworkValue } from "./yaml-framework-context";
import {
  CLI_TOKEN_REGEX_GLOBAL,
  collectWorkspaceCliVarDefinitions,
  MAINROLE_CLI_TOKEN,
} from "./core/vars-cli-and-greps";

const CLI_VAR_FULL_PATTERN = /^\$AND_CLI_([A-Za-z0-9_]+)\$$/;

function isCliVar(value: string): boolean {
  return CLI_VAR_FULL_PATTERN.test(value);
}

function getCliVarName(value: string): string {
  const match = value.match(CLI_VAR_FULL_PATTERN);
  return match?.[1] ?? value;
}

function inlayLabelForToken(
  fullToken: string,
  varName: string,
  varsValues: Map<string, Set<string>>,
  grepVarNames: Set<string>
): string {
  if (fullToken === MAINROLE_CLI_TOKEN) {
    return "main role (runtime)";
  }
  const resolved = varsValues.get(varName);
  if (resolved && resolved.size > 0) {
    return `${varName}=${[...resolved].join("|")}`;
  }
  if (grepVarNames.has(varName)) {
    return `${varName} (Greps)`;
  }
  return `${varName}=?`;
}

export class YamlInlayHintsProvider implements vscode.InlayHintsProvider {
  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range
  ): vscode.InlayHint[] {
    if (document.languageId !== "yaml") {
      return [];
    }

    const { varsValues, grepVarNames } = collectWorkspaceCliVarDefinitions(
      getFilesContentMap(getWorkspaceRoot())
    );
    const hints: vscode.InlayHint[] = [];
    const startLine = Math.max(0, range.start.line);
    const endLine = Math.min(document.lineCount - 1, range.end.line);

    for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
      const line = document.lineAt(lineNumber).text;
      const trimmed = line.trim();
      const roleMatch = trimmed.match(/^-?\s*Role\s*:\s*(.+)$/);

      if (roleMatch) {
        const roleValueRaw = roleMatch[1];
        const roleStartIndex = line.indexOf(roleValueRaw);
        if (roleStartIndex < 0) {
          continue;
        }

        const tokens = normalizeFrameworkValue(roleValueRaw)
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);

        const resolvedPieces: string[] = [];
        tokens.forEach((token) => {
          if (!isCliVar(token)) {
            return;
          }
          const varName = getCliVarName(token);
          resolvedPieces.push(inlayLabelForToken(token, varName, varsValues, grepVarNames));
        });

        if (resolvedPieces.length === 0) {
          continue;
        }

        const hintPosition = new vscode.Position(
          lineNumber,
          roleStartIndex + roleValueRaw.length
        );
        const roleHint = new vscode.InlayHint(
          hintPosition,
          ` => ${resolvedPieces.join(", ")}`,
          vscode.InlayHintKind.Type
        );
        roleHint.paddingLeft = true;
        hints.push(roleHint);
        continue;
      }

      CLI_TOKEN_REGEX_GLOBAL.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CLI_TOKEN_REGEX_GLOBAL.exec(line)) !== null) {
        const fullToken = m[0];
        const varName = m[1];
        const endCol = m.index + fullToken.length;
        const label = inlayLabelForToken(fullToken, varName, varsValues, grepVarNames);
        const hint = new vscode.InlayHint(
          new vscode.Position(lineNumber, endCol),
          ` => ${label}`,
          vscode.InlayHintKind.Type
        );
        hint.paddingLeft = true;
        hints.push(hint);
      }
    }

    return hints;
  }
}
