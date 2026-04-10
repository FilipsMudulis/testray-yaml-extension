import { FilesContentMap } from "./get-files-content-map";

export type FilesFoundInLinesMap = {
  [path: AbsoluteFilePath]: LineNumber[];
};

function findMatchingLineNumbers(
  lines: FileContentLine[],
  searchText: string
): LineNumber[] {
  return lines.reduce<LineNumber[]>((accumulator, line, index) => {
    if (isDefinition(line, searchText)) {
      accumulator.push(index + 1);
    }

    return accumulator;
  }, []);
}

export function isDefinition(line: string, searchText: string): boolean {
  const searchTextWithColon =
    searchText.at(-1) === ":" ? searchText : searchText + ":";

  if (line.startsWith(searchTextWithColon)) {
    return true;
  }

  return false;
}

export function getFilesFoundInLinesMap(
  fileContentRecord: FilesContentMap,
  searchText: string
): FilesFoundInLinesMap {
  return Object.entries(fileContentRecord).reduce<FilesFoundInLinesMap>(
    (accumulator, [filePath, lines]) => {
      const lineNumbers = findMatchingLineNumbers(lines, searchText);

      if (lineNumbers.length > 0) {
        accumulator[filePath] = lineNumbers;
      }

      return accumulator;
    },
    {}
  );
}
