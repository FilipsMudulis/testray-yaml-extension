# TestRay ↔ extension: further improvement ideas

This note is based on another pass over the **TestRay** gem (`lib/core/case_runner.rb`, `lib/core/device.rb`, `lib/utils/find.rb`, `lib/utils/load.rb`) and the current VS Code extension behavior. It is meant to complement [`SUGGESTIONS.md`](./SUGGESTIONS.md), which tracks what is already implemented.

---

## Status legend

- `DONE`: implemented in the extension
- `PARTIAL`: implemented in part; follow-up still useful
- `TODO`: not implemented yet

## Current status snapshot

| # | Topic | Status |
|---|-------|--------|
| 1 | Align completion `Type` list with real surface | PARTIAL |
| 2 | Index roles/apps from `config.yaml` | TODO |
| 3 | Structural validation (`Roles` + `Actions`) | TODO |
| 4 | Duplicate case names | DONE |
| 5 | Stricter `timer` / `if` / `loop` | PARTIAL |
| 6 | `FailCase` shape | DONE |
| 7 | `ParallelCases` checks | TODO |
| 8 | Expand required keys in `ACTION_RULES` | TODO |
| 9 | `post_call` body hinting | TODO |
| 10 | Vars, `Greps`, `$AND_CLI_*$` | PARTIAL |
| 11 | Workspace layout vs `getwd()` | TODO |
| 12 | YAML anchors/merge-key limitations | TODO |
| 13 | `MAINROLE` inferred default role | PARTIAL |
| 14 | Developer ergonomics batch | PARTIAL |

---

## 1. Align completion `Type` list with the real surface area

TestRay dispatches most actions with `@device_handler.devices[role].send(action["Type"], action)` (`case_runner.rb`), so **any public `Device` method name** is a valid `Type` for the matching platform. The extension’s completion list (`yaml-completion-provider.ts`, `ACTION_TYPES`) is a **small subset** of the methods in `device.rb` and of the action list documented in TestRay’s `README.md`.

**Suggestion:** Drive `Type` completion from the same catalog used for hovers (e.g. keys of `ACTION_DOCS` in `yaml-hover-provider.ts`), or generate a single shared `action-types.ts` from `device.rb` method names (plus control-flow types: `case`, `if`, `loop`, `sync`, `timer`, `sleep`). That removes drift between “hover knows it, completion doesn’t.”

**Status:** `PARTIAL`  
`$AND_CLI_*` completion was added, but action `Type` completion still uses a smaller static list and is not unified with hover/action docs yet.

---

## 2. Index roles and apps from `cases/config.yaml` like the runner does

At runtime, TestRay validates:

- **Roles** against `$config["Devices"][*]["role"]` (comma-separated lists) (`check_case_roles_apps` in `find.rb`).
- **Apps** against `$config["Apps"]` keys plus **`browser`**, **`command`**, **`desktop`** (`find.rb`).

The extension currently collects **role names from `Role:` lines** in YAML across the workspace (`buildSymbolIndex` in completion/diagnostics). That helps authoring but can diverge from config (typos in `Role:` that never appear elsewhere, or valid config roles not yet used in a case file).

**Suggestion:** Prefer (or merge) role and app suggestions from parsed **`Devices`** and **`Apps`** under `config.yaml` (and the same reserved app names as TestRay). Optionally warn when a `Role`/`App` in a case does not exist in the indexed config.

**Status:** `TODO`

---

## 3. Structural validation: `Roles` + `Actions` on each case

`check_case_structure` in `find.rb` requires non-empty **`Roles`** (list, each with `Role` and `App`) and **`Actions`** (list). The extension focuses on actions and references but does not surface “missing `Roles` block” / “missing `Actions`” as file-level diagnostics.

**Suggestion:** Add diagnostics (or a dedicated “Validate case shape” command) for case blocks that look like TestRay cases (top-level key with nested content) when `Roles` or `Actions` is absent or wrong type. Tune for **set** files vs **case** files so sets are not misclassified.

**Status:** `TODO`

---

## 4. Duplicate case names across `cases/**/case*.yaml`

`load_case_files` in `load.rb` scans `cases/**/case*.yaml`, merges YAML, and **aborts on duplicate top-level case names** across files. The extension could report the same condition as an error or warning when the workspace layout matches TestRay’s (`cases/` tree).

**Suggestion:** When multiple YAML files define the same top-level case key, emit a diagnostic pointing at each declaration (mirroring TestRay’s duplicate detection).

**Status:** `DONE`  
Implemented via duplicate-case collection + diagnostics with related locations.

---

## 5. Control-flow actions: stricter `timer`, `if`, `loop`

`SYNC_ACTIONS = ["case", "loop", "if", "sync", "timer"]` (`case_runner.rb`). The extension already models `if` / `loop` / `sync` in rules and hovers; **`timer`** expects `Role` of `start` or `end` (`timer_handler` in `types_control_flow.rb`).

**Suggestion:** Add diagnostics for `Type: timer` when `Role` is not `start`/`end` or when pairing is inconsistent (optional; can stay warning-level).

For **`if`**, Ruby requires `If_Cases` to be an array of objects with at least `If_Case`; optional `Else_Case`. Deeper validation would match that shape.

For **`loop`**, TestRay uses `Times` as integer iteration count (`loop_handler`); validating numeric `Times` and defined `Case` would catch common mistakes.

**Status:** `PARTIAL`  
Implemented: `timer` role validation (`start`/`end`), `if` list-item `If_Case` checks, `loop` `Times` numeric check, and `loop` target-case existence check.  
Open: optional timer pairing consistency (start/end pairing semantics).

---

## 6. `FailCase` shape

On action failure, TestRay runs `run(action["FailCase"]["Value"], ...)` and respects `ContinueOnFail` (`case_runner.rb`). The extension does not validate nested `FailCase` objects.

**Suggestion:** Optional diagnostics: `FailCase` must include `Value` referencing an existing case; if `ContinueOnFail` is present, it should be boolean-like.

**Status:** `DONE`  
Implemented: `FailCase` child parsing (map/list/simple inline), required `Value`, empty/missing checks, target-case existence warning, and `ContinueOnFail` boolean-like validation.

---

## 7. `ParallelCases` and parallel `Type: case`

Parallel execution is controlled by `ParallelCases` on the case and `parallel_case_handler` (`types_control_flow.rb`). 

**Suggestion:** Warn if `ParallelCases` is missing or non-numeric when parallel case calls are used, or document in hovers that `ParallelCases` caps concurrent threads. Low priority unless users hit runtime errors often.

**Status:** `TODO`

---

## 8. Required keys: expand beyond the current `ACTION_RULES` (carefully)

`ACTION_RULES` in `yaml-diagnostics.ts` only covers a handful of types. Many `Device` methods expect **`Strategy` + `Id`** (e.g. `send_keys`, `wait_for`, `clear_field`) per TestRay’s README. Fully mirroring Ruby (including list-valued Strategy/Id, optional `Condition`, offsets) is **not** a small static schema.

**Suggestion:** Incrementally add rules for the most common types (`send_keys`, `wait_for`, `get_attribute`, …) with the same pragmatic rule as today: **only flag when both are missing** if the README says both are required for the “simple” form. Keep **unknown `Type`** as allowed (custom/device methods).

**Status:** `TODO`

---

## 9. `post_call` / API actions

Logging in `case_runner.rb` treats `post_call` with `Url` and optional `Body`. Your diagnostics require `Url` only, which matches the common case.

**Suggestion:** If users report empty-body failures, add a **hint** (not necessarily error) when `Body` is absent for endpoints that need a payload—this may be too heuristic; low priority.

**Status:** `TODO`

---

## 10. Vars, `Greps`, and `$AND_CLI_*$`

TestRay loads vars from case/set headers, actions, and greps; substitution uses `$AND_CLI_<NAME>$` (`README.md`, `load.rb` flow). The extension already handles **role** CLI vars and inlay hints for `Role:` lines.

**Suggestion:** Extend **inlay hints** or **hover** on **values** that contain `$AND_CLI_FOO$` (not only `Role:`) when `FOO` is defined under a `Vars:` section in scope—harder because scope follows execution order. A lighter win: **completion** for var names after `$AND_CLI_` when known from workspace `Vars` blocks.

**Status:** `PARTIAL`  
Implemented: `$AND_CLI_*` completion, hover for CLI tokens with Vars/Greps context, and inlay hints on non-`Role` value lines.  
Open: true execution-order/scoped var resolution (currently workspace-level approximation).

---

## 11. Workspace layout vs `getwd()`

TestRay resolves `cases/config.yaml` and `cases/**/case*.yaml` relative to the **process current working directory**, not necessarily the editor workspace root. The extension uses **workspace root** for scanning.

**Suggestion:** Support a setting such as `yamlGoToDefinition.testRayProjectRoot` or detect `cases/config.yaml` under subfolders when the repo root is not the TestRay project root. Document the limitation in the README until then.

**Status:** `TODO`

---

## 12. YAML features Ruby accepts but line-based tools miss

Ruby uses `YAML.load_file`, which supports **aliases/anchors** and merge keys. The extension’s line-oriented parsers do not execute a full YAML merge.

**Suggestion:** Document as a known limitation. Long-term: optional **parsed-YAML** path for critical features (references) using a YAML parser with line/column maps—higher cost, fewer surprises for advanced YAML.

**Status:** `TODO`

---

## 13. `MAINROLE` and runtime-only tokens

`ENV["MAINROLE"]` is set from the first case role or parent (`case_runner.rb`). Inlay text **“main role (runtime)”** for `$AND_CLI_MAINROLE$` is accurate but not a concrete role name.

**Suggestion:** Optionally show the **resolved default role** when it can be inferred from the same file’s `Roles[0].Role` (static approximation only).

**Status:** `PARTIAL`  
Current behavior: explicit runtime marker (“main role (runtime)”) for `$AND_CLI_MAINROLE$`; no inferred static default role yet.

---

## 14. Developer ergonomics

- **Single source of truth:** One generated or shared list of action types + required keys shared by completion, hover, diagnostics, and tests.
- **Golden tests:** Snapshot a few files from `TestRay/examples/tests` and assert diagnostics/reference counts don’t regress.
- **Link out:** In hovers, add a “See TestRay README” link to the matching anchor when the doc section exists—keeps the editor light while pointing to the full spec.

---
**Status:** `PARTIAL`  
Unit tests were expanded for new helper modules; remaining items are unified action metadata, golden fixtures from `examples/tests`, and README deep-linking from hovers.

## Priority sketch

| Priority | Item |
|----------|------|
| High | Unify `Type` completion with hover/device surface (§1); index roles/apps from config (§2) |
| Medium | Duplicate case detection (§4); case structure `Roles`/`Actions` (§3); config path setting (§11) |
| Lower | Timer/if/loop/failcase tightening (§5–§7); var completion for `$AND_CLI_` (§10); full YAML parse (§12) |

---

*Generated from TestRay source and `examples/tests` layout as of the review date; re-run this audit when upgrading TestRay major versions.*
