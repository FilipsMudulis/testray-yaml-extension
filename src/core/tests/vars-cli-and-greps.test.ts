import {
  collectWorkspaceCliVarDefinitions,
  findCliTokenAtColumn,
  isInsideGrepsSection,
  parseAndCliCompletionPrefix,
  sortedCliVarNameSuggestions,
} from "../vars-cli-and-greps";

describe("parseAndCliCompletionPrefix", () => {
  it("detects suffix after $AND_CLI_", () => {
    expect(parseAndCliCompletionPrefix('Value: $AND_CLI_')).toEqual({ partial: "", replaceStart: 7 });
    expect(parseAndCliCompletionPrefix("  $AND_CLI_GRE")).toEqual({ partial: "GRE", replaceStart: 2 });
  });

  it("returns undefined when not completing CLI var", () => {
    expect(parseAndCliCompletionPrefix("Value: foo")).toBeUndefined();
    expect(parseAndCliCompletionPrefix("Value: $AND_CLI_X ")).toBeUndefined();
  });
});

describe("findCliTokenAtColumn", () => {
  it("finds token under cursor", () => {
    const line = '  Value: https://x.com/$AND_CLI_LINK$/path';
    const hit = findCliTokenAtColumn(line, line.indexOf("LINK") + 1);
    expect(hit?.varName).toBe("LINK");
    expect(hit?.fullToken).toBe("$AND_CLI_LINK$");
  });
});

describe("isInsideGrepsSection", () => {
  it("detects var line and nested grep keys under Greps", () => {
    const lines = [
      "  - Type: get_url",
      "    Greps:",
      "      - var: GREPPED_CONTENT",
      "        match: x",
    ];
    expect(isInsideGrepsSection(lines, 2)).toBe(true);
    expect(isInsideGrepsSection(lines, 3)).toBe(true);
    expect(isInsideGrepsSection(lines, 0)).toBe(false);
  });
});

describe("collectWorkspaceCliVarDefinitions", () => {
  it("collects Vars and Greps var names", () => {
    const map = {
      "/f.yaml": [
        "CaseA:",
        "  Vars:",
        "    LINK: https://a",
        "  Actions:",
        "  - Type: navigate",
        "    Value: $AND_CLI_LINK$",
        "    Greps:",
        "      - var: SCRAPED",
        "        match: .*",
      ],
    };
    const { varsValues, grepVarNames } = collectWorkspaceCliVarDefinitions(map);
    expect(varsValues.get("LINK")).toEqual(new Set(["https://a"]));
    expect(grepVarNames.has("SCRAPED")).toBe(true);
  });
});

describe("sortedCliVarNameSuggestions", () => {
  it("filters by prefix", () => {
    const vars = new Map<string, Set<string>>([["FOO", new Set(["1"])]]);
    const greps = new Set(["FUM"]);
    expect(sortedCliVarNameSuggestions(vars, greps, "FU")).toEqual(["FUM"]);
    expect(sortedCliVarNameSuggestions(vars, greps, "")).toEqual(["FOO", "FUM"]);
  });
});
