import * as vscode from "vscode";
import { getFilesContentMap } from "./core/get-files-content-map";
import { getWorkspaceRoot } from "./utils/get-workspace-root";
import {
  getParentCollectionKey,
  isUnderCasesCollection,
  normalizeFrameworkValue,
  previousActionTypeIsCase,
  ROOT_NON_CASE_KEYS,
} from "./yaml-framework-context";

function increaseCount(counter: Map<string, number>, name: string) {
  counter.set(name, (counter.get(name) ?? 0) + 1);
}

function getCaseReferenceCounts(): Map<string, number> {
  const filesContentMap = getFilesContentMap(getWorkspaceRoot());
  const counts = new Map<string, number>();
  const gherkinRefsByStepText = new Map<string, number>();
  const stepTextsByCaseName = new Map<string, Set<string>>();

  Object.values(filesContentMap).forEach((lines) => {
    let currentCaseName: string | undefined;
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return;
      }
      const indent = line.length - line.trimStart().length;

      const topDef = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
      if (indent === 0 && topDef) {
        currentCaseName = ROOT_NON_CASE_KEYS.has(topDef[1]) ? undefined : topDef[1];
      }

      if (currentCaseName) {
        const stepDef = trimmed.match(/^Step\s*:\s*(.+)$/);
        if (stepDef) {
          const text = normalizeFrameworkValue(stepDef[1]);
          const existing = stepTextsByCaseName.get(currentCaseName) ?? new Set<string>();
          existing.add(text);
          stepTextsByCaseName.set(currentCaseName, existing);
        }
      }

      const valueMatch = trimmed.match(/^Value\s*:\s*(.+)$/);
      if (valueMatch && previousActionTypeIsCase(lines, index, indent)) {
        increaseCount(counts, normalizeFrameworkValue(valueMatch[1]));
      }

      const listItemMatch = trimmed.match(/^-\s*(.+)$/);
      if (listItemMatch) {
        const parent = getParentCollectionKey(lines, index, indent);
        if (parent === "Precases" || parent === "Aftercases") {
          increaseCount(counts, normalizeFrameworkValue(listItemMatch[1]));
        }
      }

      const setCaseMatch = trimmed.match(/^Case\s*:\s*(.+)$/);
      if (setCaseMatch && isUnderCasesCollection(lines, index, indent)) {
        increaseCount(counts, normalizeFrameworkValue(setCaseMatch[1]));
      }

      for (const key of ["Given", "Then", "And", "But", "When"]) {
        const gherkin = trimmed.match(new RegExp(`^-?\\s*${key}\\s*:\\s*(.+)$`));
        if (gherkin) {
          increaseCount(gherkinRefsByStepText, normalizeFrameworkValue(gherkin[1]));
          break;
        }
      }
    });
  });

  stepTextsByCaseName.forEach((stepTexts, caseName) => {
    stepTexts.forEach((stepText) => {
      const refs = gherkinRefsByStepText.get(stepText) ?? 0;
      if (refs > 0) {
        increaseCount(counts, caseName);
        if (refs > 1) {
          counts.set(caseName, (counts.get(caseName) ?? 0) + (refs - 1));
        }
      }
    });
  });

  return counts;
}

export class YamlCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.languageId !== "yaml") {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];
    const referenceCounts = getCaseReferenceCounts();

    for (let i = 0; i < document.lineCount; i += 1) {
      const line = document.lineAt(i).text;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const indent = line.length - line.trimStart().length;
      if (indent !== 0) {
        continue;
      }

      const topDefMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
      if (!topDefMatch) {
        continue;
      }

      const caseName = topDefMatch[1];
      if (ROOT_NON_CASE_KEYS.has(caseName)) {
        continue;
      }

      const references = referenceCounts.get(caseName) ?? 0;
      const title = references === 1 ? "1 reference" : `${references} references`;
      const nameStart = line.indexOf(caseName);
      const anchorPos = new vscode.Position(i, Math.max(0, nameStart));
      const range = new vscode.Range(anchorPos, anchorPos);

      if (references === 0) {
        lenses.push(
          new vscode.CodeLens(range, {
            title,
            command: "",
          })
        );
        continue;
      }

      lenses.push(
        new vscode.CodeLens(range, {
          title,
          command: "yaml-go-to-definition.showCaseReferences",
          arguments: [document.uri, anchorPos],
        })
      );
    }

    return lenses;
  }
}
