import * as vscode from "vscode";
import { YamlDefinitionProvider } from "./yaml-definition-provider";
import { YamlReferenceProvider } from "./yaml-reference-provider";
import { YamlRenameProvider } from "./yaml-rename-provider";
import { YamlDiagnostics } from "./yaml-diagnostics";
import { YamlCompletionProvider } from "./yaml-completion-provider";
import { YamlHoverProvider } from "./yaml-hover-provider";
import { YamlCodeActionsProvider } from "./yaml-code-actions-provider";
import { YamlDocumentSymbolProvider } from "./yaml-document-symbol-provider";
import { YamlCodeLensProvider } from "./yaml-codelens-provider";
import { YamlWorkspaceSymbolProvider } from "./yaml-workspace-symbol-provider";
import { YamlInlayHintsProvider } from "./yaml-inlay-hints-provider";
import { Cache } from "./utils/cache";
import { Logger } from "./utils/logger";
import { isDebug } from "./constants";

export function activate(context: vscode.ExtensionContext) {
  const logger = new Logger(isDebug ? console : undefined);

  const cacheTime = 5000 * 1;
  const definitionCache = new Cache<vscode.Location[]>(cacheTime);
  const referenceCache = new Cache<vscode.Location[]>(cacheTime);
  const diagnosticsCollection =
    vscode.languages.createDiagnosticCollection("yaml-go-to-definition");
  const yamlDiagnostics = new YamlDiagnostics(diagnosticsCollection, logger);

  context.subscriptions.push(
    diagnosticsCollection,
    vscode.languages.registerDefinitionProvider(
      "yaml",
      new YamlDefinitionProvider(definitionCache, logger)
    ),
    vscode.languages.registerReferenceProvider(
      "yaml",
      new YamlReferenceProvider(referenceCache, logger)
    ),
    vscode.languages.registerRenameProvider(
      "yaml",
      new YamlRenameProvider(logger)
    ),
    vscode.languages.registerCompletionItemProvider(
      "yaml",
      new YamlCompletionProvider(logger),
      ":",
      " ",
      ",",
      "-",
      "$"
    ),
    vscode.languages.registerHoverProvider("yaml", new YamlHoverProvider()),
    vscode.languages.registerCodeActionsProvider(
      "yaml",
      new YamlCodeActionsProvider(),
      { providedCodeActionKinds: YamlCodeActionsProvider.providedCodeActionKinds }
    ),
    vscode.languages.registerDocumentSymbolProvider(
      "yaml",
      new YamlDocumentSymbolProvider()
    ),
    vscode.languages.registerWorkspaceSymbolProvider(
      new YamlWorkspaceSymbolProvider()
    ),
    vscode.languages.registerInlayHintsProvider(
      "yaml",
      new YamlInlayHintsProvider()
    ),
    vscode.languages.registerCodeLensProvider("yaml", new YamlCodeLensProvider()),
    vscode.commands.registerCommand(
      "yaml-go-to-definition.showCaseReferences",
      async (uri: vscode.Uri, position: vscode.Position) => {
        const locations = await vscode.commands.executeCommand<vscode.Location[]>(
          "vscode.executeReferenceProvider",
          uri,
          position
        );

        await vscode.commands.executeCommand(
          "editor.action.showReferences",
          uri,
          position,
          locations ?? []
        );
      }
    ),
    vscode.workspace.onDidOpenTextDocument((document) =>
      yamlDiagnostics.refreshDocument(document)
    ),
    vscode.workspace.onDidChangeTextDocument((event) =>
      yamlDiagnostics.refreshDocument(event.document)
    ),
    vscode.workspace.onDidSaveTextDocument((document) =>
      yamlDiagnostics.refreshDocument(document)
    ),
    vscode.workspace.onDidCloseTextDocument((document) =>
      yamlDiagnostics.clearDocument(document.uri)
    )
  );

  vscode.workspace.textDocuments.forEach((document) =>
    yamlDiagnostics.refreshDocument(document)
  );
  void yamlDiagnostics.refreshWorkspace();
}
