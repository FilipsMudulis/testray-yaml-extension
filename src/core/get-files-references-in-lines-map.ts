import { FilesContentMap } from "./get-files-content-map";
import { FilesFoundInLinesMap, isDefinition } from "./get-files-found-in-lines-map";

function normalizeSearchText(searchText: string): string {
  return searchText.endsWith(":") ? searchText.slice(0, -1) : searchText;
}

function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isReference(line: string, searchText: string): boolean {
  if (isDefinition(line, searchText)) {
    return false;
  }

  const escapedSearchText = escapeForRegex(searchText);
  const pattern = new RegExp(`(^|[^A-Za-z0-9_.-])${escapedSearchText}([^A-Za-z0-9_.-]|$)`);
  return pattern.test(line);
}

function findReferenceLineNumbers(
  lines: FileContentLine[],
  searchText: string
): LineNumber[] {
  return lines.reduce<LineNumber[]>((accumulator, line, index) => {
    if (isReference(line, searchText)) {
      accumulator.push(index + 1);
    }

    return accumulator;
  }, []);
}

export function getFilesReferencesInLinesMap(
  fileContentRecord: FilesContentMap,
  searchText: string
): FilesFoundInLinesMap {
  const normalizedSearchText = normalizeSearchText(searchText);

  return Object.entries(fileContentRecord).reduce<FilesFoundInLinesMap>(
    (accumulator, [filePath, lines]) => {
      const lineNumbers = findReferenceLineNumbers(lines, normalizedSearchText);

      if (lineNumbers.length > 0) {
        accumulator[filePath] = lineNumbers;
      }

      return accumulator;
    },
    {}
  );
}
