import * as vscode from "vscode";

const MISSING_REQUIRED_KEY_CODE_PREFIX = "yaml-framework:missing-required-key:";
const MISSING_CASE_CODE_PREFIX = "yaml-framework:missing-case:";
const MISSING_ENV_CODE_PREFIX = "yaml-framework:missing-environment:";

export class YamlCodeActionsProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    context.diagnostics.forEach((diagnostic) => {
      const code = typeof diagnostic.code === "string" ? diagnostic.code : undefined;
      if (!code) {
        return;
      }

      if (code.startsWith(MISSING_REQUIRED_KEY_CODE_PREFIX)) {
        const [, , actionType, requiredKey] = code.split(":");
        if (!actionType || !requiredKey) {
          return;
        }

        const line = document.lineAt(diagnostic.range.start.line);
        const actionIndent = line.firstNonWhitespaceCharacterIndex;
        const keyIndent = " ".repeat(actionIndent + 2);
        const keySnippet = `${keyIndent}${requiredKey}: \n`;

        const edit = new vscode.WorkspaceEdit();
        const insertPos = new vscode.Position(diagnostic.range.start.line + 1, 0);
        edit.insert(document.uri, insertPos, keySnippet);

        const quickFix = new vscode.CodeAction(
          `Add missing key \`${requiredKey}\` for \`${actionType}\``,
          vscode.CodeActionKind.QuickFix
        );
        quickFix.diagnostics = [diagnostic];
        quickFix.edit = edit;
        actions.push(quickFix);
        return;
      }

      if (code.startsWith(MISSING_CASE_CODE_PREFIX)) {
        const name = code.slice(MISSING_CASE_CODE_PREFIX.length);
        if (!name) {
          return;
        }
        const edit = new vscode.WorkspaceEdit();
        const insertion = `\n${name}:\n  Roles:\n    - Role: command1\n      App: command\n  Actions:\n    - Type: sleep\n      Time: 1\n`;
        edit.insert(document.uri, new vscode.Position(document.lineCount, 0), insertion);
        const quickFix = new vscode.CodeAction(
          `Create missing case \`${name}\``,
          vscode.CodeActionKind.QuickFix
        );
        quickFix.diagnostics = [diagnostic];
        quickFix.edit = edit;
        actions.push(quickFix);
        return;
      }

      if (code.startsWith(MISSING_ENV_CODE_PREFIX)) {
        const name = code.slice(MISSING_ENV_CODE_PREFIX.length);
        if (!name) {
          return;
        }
        const edit = new vscode.WorkspaceEdit();
        const fullText = document.getText();
        const envSectionMatch = fullText.match(/^Environments\s*:\s*$/m);
        if (envSectionMatch && envSectionMatch.index !== undefined) {
          const before = fullText.slice(0, envSectionMatch.index);
          const envLine = before.split("\n").length - 1;
          const insertPos = new vscode.Position(envLine + 1, 0);
          edit.insert(document.uri, insertPos, `  ${name}:\n    Vars:\n      EXAMPLE: VALUE\n`);
        } else {
          edit.insert(
            document.uri,
            new vscode.Position(document.lineCount, 0),
            `\nEnvironments:\n  ${name}:\n    Vars:\n      EXAMPLE: VALUE\n`
          );
        }
        const quickFix = new vscode.CodeAction(
          `Create missing environment \`${name}\``,
          vscode.CodeActionKind.QuickFix
        );
        quickFix.diagnostics = [diagnostic];
        quickFix.edit = edit;
        actions.push(quickFix);
      }
    });

    return actions;
  }
}
