import { FilesContentMap } from "./get-files-content-map";
import { ROOT_NON_CASE_KEYS } from "../yaml-framework-context";

export type CaseDefinitionSite = {
  absolutePath: string;
  line: number;
  nameStart: number;
  nameEnd: number;
};

function getIndentation(line: string): number {
  return line.length - line.trimStart().length;
}

/** Top-level `CaseName:` block headers (indent 0, value on next lines), excluding config root keys. */
export function collectCaseDefinitionSites(filesContentMap: FilesContentMap): Map<string, CaseDefinitionSite[]> {
  const byName = new Map<string, CaseDefinitionSite[]>();

  Object.entries(filesContentMap).forEach(([absolutePath, lines]) => {
    lines.forEach((line, lineIndex) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return;
      }
      if (getIndentation(line) !== 0) {
        return;
      }
      const topDef = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
      if (!topDef || ROOT_NON_CASE_KEYS.has(topDef[1])) {
        return;
      }
      const name = topDef[1];
      const nameStart = line.indexOf(name);
      if (nameStart < 0) {
        return;
      }
      const site: CaseDefinitionSite = {
        absolutePath,
        line: lineIndex,
        nameStart,
        nameEnd: nameStart + name.length,
      };
      const list = byName.get(name) ?? [];
      list.push(site);
      byName.set(name, list);
    });
  });

  return byName;
}
