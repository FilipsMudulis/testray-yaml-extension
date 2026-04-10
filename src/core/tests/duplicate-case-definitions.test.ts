import * as path from "path";
import { collectCaseDefinitionSites } from "../duplicate-case-definitions";

describe("collectCaseDefinitionSites", () => {
  const root = path.resolve("/workspace");

  it("collects multiple files declaring the same top-level case", () => {
    const filesContentMap = {
      [path.join(root, "a.yaml")]: ["DupCase:", "  Roles:", "    - Role: r", "      App: command"],
      [path.join(root, "b.yaml")]: ["DupCase:", "  Actions: []"],
    };

    const map = collectCaseDefinitionSites(filesContentMap);
    expect(map.get("DupCase")).toHaveLength(2);
    expect(map.get("DupCase")?.map((s) => s.line)).toEqual([0, 0]);
  });

  it("collects duplicate definitions in one file", () => {
    const filesContentMap = {
      [path.join(root, "x.yaml")]: ["DupCase:", "  x: 1", "", "DupCase:", "  y: 2"],
    };

    const map = collectCaseDefinitionSites(filesContentMap);
    expect(map.get("DupCase")).toHaveLength(2);
    expect(map.get("DupCase")?.map((s) => s.line)).toEqual([0, 3]);
  });

  it("ignores Apps, Environments, and other root non-case keys", () => {
    const filesContentMap = {
      [path.join(root, "config.yaml")]: [
        "Apps:",
        "  MyApp:",
        "Environments:",
        "  E1:",
        "Devices:",
        "  - role: r",
      ],
    };

    const map = collectCaseDefinitionSites(filesContentMap);
    expect([...map.keys()]).toEqual([]);
  });

  it("does not treat indented keys as case definitions", () => {
    const filesContentMap = {
      [path.join(root, "c.yaml")]: ["SomeCase:", "  NestedBlock:", "    x: 1"],
    };

    const map = collectCaseDefinitionSites(filesContentMap);
    expect(map.get("SomeCase")).toHaveLength(1);
    expect(map.has("NestedBlock")).toBe(false);
  });

  it("returns singleton map entries for unique names", () => {
    const filesContentMap = {
      [path.join(root, "one.yaml")]: ["OnlyCase:", "  Roles: []"],
    };

    const map = collectCaseDefinitionSites(filesContentMap);
    expect(map.get("OnlyCase")).toHaveLength(1);
  });
});
