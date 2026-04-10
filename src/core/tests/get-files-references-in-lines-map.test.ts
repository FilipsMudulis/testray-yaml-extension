import { FilesContentMap } from "../get-files-content-map";
import { getFilesReferencesInLinesMap } from "../get-files-references-in-lines-map";

describe("getFilesReferencesInLinesMap", () => {
  const fileContentRecord: FilesContentMap = {
    "/data/d/d.yaml": [".d: d"],
    "/data/c.yaml": [".c: c"],
    "/data/b.yml": [".b: b\r", ""],
    "/data/a.yaml": [
      ".a:\r",
      "  extends: .b\r",
      "  value: !reference [.c]\r",
      "  nested: .b\r",
      "  unrelated: .bb\r",
      "",
    ],
  };

  it("should find references and exclude definitions", () => {
    const searchText = ".b";

    const result = getFilesReferencesInLinesMap(fileContentRecord, searchText);

    const expected = {
      "/data/a.yaml": [2, 4],
    };

    expect(result).toEqual(expected);
  });

  it("should treat trailing colon as definition token format", () => {
    const searchText = ".b:";

    const result = getFilesReferencesInLinesMap(fileContentRecord, searchText);

    const expected = {
      "/data/a.yaml": [2, 4],
    };

    expect(result).toEqual(expected);
  });
});
