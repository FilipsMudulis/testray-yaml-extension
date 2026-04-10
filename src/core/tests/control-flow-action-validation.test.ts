import {
  findIfCasesLineIndex,
  findRoleValueInAction,
  isTimerRoleValid,
  isValidLoopTimesValue,
  parseLoopCaseName,
  parseLoopTimesRaw,
  validateIfCasesListItems,
} from "../control-flow-action-validation";

describe("timer / loop helpers", () => {
  it("findRoleValueInAction returns first Role in block", () => {
    expect(findRoleValueInAction(["  Role: start", "  Description: x"])).toBe("start");
    expect(findRoleValueInAction(["  Role: END"])).toBe("END");
  });

  it("isTimerRoleValid accepts start and end only", () => {
    expect(isTimerRoleValid("start")).toBe(true);
    expect(isTimerRoleValid("End")).toBe(true);
    expect(isTimerRoleValid(undefined)).toBe(false);
    expect(isTimerRoleValid("desktop1")).toBe(false);
  });

  it("parseLoopTimesRaw and isValidLoopTimesValue", () => {
    expect(parseLoopTimesRaw(["  Times: 3"])).toBe("3");
    expect(isValidLoopTimesValue("3")).toBe(true);
    expect(isValidLoopTimesValue("0")).toBe(true);
    expect(isValidLoopTimesValue("3.5")).toBe(false);
    expect(isValidLoopTimesValue("-1")).toBe(false);
    expect(isValidLoopTimesValue(undefined)).toBe(false);
  });

  it("parseLoopCaseName", () => {
    expect(parseLoopCaseName(["  Case: MyLoopCase"])).toBe("MyLoopCase");
  });
});

describe("validateIfCasesListItems", () => {
  it("returns no issues for TestRay-style If_Cases blocks", () => {
    const lines = [
      "  - Type: if",
      "    If_Cases:",
      "      - If_Case: A",
      "      - If_Case: B",
      "    Else_Case: C",
    ];
    const ifIdx = findIfCasesLineIndex(lines);
    expect(ifIdx).toBe(1);
    expect(validateIfCasesListItems(lines, ifIdx)).toEqual([]);
  });

  it("allows empty If_Cases: []", () => {
    const lines = ["  - Type: if", "    If_Cases: []", "    Else_Case: C"];
    const ifIdx = findIfCasesLineIndex(lines);
    expect(validateIfCasesListItems(lines, ifIdx)).toEqual([]);
  });

  it("flags a list item missing If_Case", () => {
    const lines = [
      "  - Type: if",
      "    If_Cases:",
      "      - Do_Case: OnlyThis",
      "    Else_Case: C",
    ];
    const ifIdx = findIfCasesLineIndex(lines);
    const issues = validateIfCasesListItems(lines, ifIdx);
    expect(issues).toHaveLength(1);
    expect(issues[0].itemStartLine).toBe(2);
  });

  it("accepts If_Case on a continuation line", () => {
    const lines = [
      "  - Type: if",
      "    If_Cases:",
      "      - ",
      "        If_Case: A",
      "    Else_Case: C",
    ];
    const ifIdx = findIfCasesLineIndex(lines);
    expect(validateIfCasesListItems(lines, ifIdx)).toEqual([]);
  });
});
                                             