import {
  findFailCaseLineIndex,
  isContinueOnFailBooleanLike,
  parseFailCaseChildren,
  resolveFailCaseValueName,
} from "../fail-case-validation";

describe("parseFailCaseChildren", () => {
  it("parses mapping style", () => {
    const lines = [
      "  - Type: click",
      "    FailCase:",
      "      Value: ErrorCase",
      "      ContinueOnFail: true",
    ];
    const idx = findFailCaseLineIndex(lines);
    expect(idx).toBe(1);
    const m = parseFailCaseChildren(lines, idx);
    expect(m.get("Value")?.valueRaw).toBe("ErrorCase");
    expect(m.get("ContinueOnFail")?.valueRaw).toBe("true");
  });

  it("parses README-style list items", () => {
    const lines = [
      "  - Type: click",
      "    FailCase:",
      "      - Value: ErrorCase",
      "      - ContinueOnFail: false",
    ];
    const idx = findFailCaseLineIndex(lines);
    const m = parseFailCaseChildren(lines, idx);
    expect(m.get("Value")?.valueRaw).toBe("ErrorCase");
    expect(m.get("ContinueOnFail")?.valueRaw).toBe("false");
  });

  it("parses simple inline flow map on same line", () => {
    const lines = ["  - Type: click", "    FailCase: { Value: InlineCase, ContinueOnFail: true }"];
    const idx = findFailCaseLineIndex(lines);
    const m = parseFailCaseChildren(lines, idx);
    expect(m.get("Value")?.valueRaw).toBe("InlineCase");
    expect(m.get("ContinueOnFail")?.valueRaw).toBe("true");
  });

  it("returns empty map for unparseable inline (no false map keys)", () => {
    const lines = ["  FailCase: $REF$"];
    const m = parseFailCaseChildren(lines, 0);
    expect(m.size).toBe(0);
  });
});

describe("resolveFailCaseValueName", () => {
  it("uses same-line value", () => {
    expect(
      resolveFailCaseValueName({ relativeLine: 0, valueRaw: "Foo" }, ["Value: Foo"])
    ).toBe("Foo");
  });

  it("reads next indented line when Value: is empty", () => {
    const lines = ["      Value:", "        BarCase"];
    expect(resolveFailCaseValueName({ relativeLine: 0, valueRaw: "" }, lines)).toBe("BarCase");
  });
});

describe("isContinueOnFailBooleanLike", () => {
  it("accepts YAML booleans and strings", () => {
    expect(isContinueOnFailBooleanLike("true")).toBe(true);
    expect(isContinueOnFailBooleanLike("false")).toBe(true);
    expect(isContinueOnFailBooleanLike("yes")).toBe(false);
  });
});
