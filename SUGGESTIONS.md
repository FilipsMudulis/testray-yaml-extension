# Suggestions for TestRay YAML Extension Features

Based on the YAML structure in `TestRay/examples/tests` (cases and sets), here are useful features to add to the extension.

## Observed YAML Structure Patterns

- Top-level named entities:
  - Case definitions like `TestCommandE2E:`, `DesktopCaseError:`
  - Set definitions like `SetExample1:`
- Cross-file references:
  - `Actions -> Type: case -> Value: <CaseName>`
  - Gherkin steps `Given/And/Then: <Step text>`
  - `Precases` / `Aftercases` case references
  - `Environment: <Name>` and `Inherit: [<EnvName>]`
  - `Role` values that should align with configured roles/devices
- Schema-like behavior:
  - `Type` determines expected keys (`click`, `navigate`, `get_call`, `assert`, `case`, etc.)
  - DSL mixes standard action objects and Gherkin-style action lines

## High-Value Feature Suggestions

### 1) Schema-aware validation diagnostics (Implemented)

- Add inline errors/warnings for missing or invalid keys based on action `Type`.
- Examples:
  - `Type: click` should have `Strategy` and `Id`
  - `Type: case` should have `Value`
  - `Type: get_call` should have `Url`
- Benefit: catches runtime test failures early.
- Status:
  - Added a diagnostics provider in the extension.
  - Checks now align with TestRay runtime behavior:
    - action `Role` is treated as optional (inherited/defaulted by runner)
    - Gherkin steps (`Given`/`Then`/`And`/`But`/`When`) are treated as case actions
    - expanded built-in action coverage (`post_call`, `launch_app`, `terminate_app`, `if`, `loop`, etc.)
    - unknown custom action types are allowed (no false-positive warning)
  - Diagnostics refresh on YAML open/edit/save across workspace files.

### 2) Context-aware autocomplete (Implemented)

- Suggest case names in `Value` when `Type: case`.
- Suggest environment names for `Environment` and `Inherit`.
- Suggest role names for `Role` fields from known role declarations/config.
- Suggest enum-like values for:
  - action `Type`
  - condition `Operation`
  - assert `Type`
- Benefit: faster authoring and fewer typos.
- Status:
  - Added context-aware completion provider for YAML.
  - Implemented suggestions for:
    - `Type` values (framework action types)
    - `Operation` enum values
    - case names for `Value` when `Type: case`
    - case names for set entries under `Cases -> Case`
    - environment names for `Environment` and `Inherit` list items
    - role names for `Role`

### 3) Framework-aware Go To Definition (Implemented)

- Keep base token navigation, but add semantic jumps for:
  - `Precases` / `Aftercases` entries -> case definitions
  - `Type: case` + `Value` -> target case
  - Gherkin step text -> matching `Step:` case definition(s)
- Benefit: navigation behaves like the framework semantics, not just text lookup.
- Status:
  - Added context-aware resolution in definition provider.
  - Implemented semantic navigation for:
    - `Type: case` -> `Value` to case definitions
    - `Precases` / `Aftercases` list items to case definitions
    - set `Cases -> Case` entries to case definitions
    - Gherkin step entries (`Given`/`Then`/`And`/`But`/`When`) to matching `Step:` definitions
    - `Environment` and `Inherit` entries to environment definitions in `Environments`
    - `Role` entries to role definition lines
  - Falls back to generic token-based behavior when no framework context matches.

### 4) Semantic Find References (Implemented)

- For a case symbol, return references from:
  - `Type: case` `Value`
  - `Precases` / `Aftercases`
  - sets under `Cases -> Case`
- For environments/roles, return references from all relevant fields.
- Benefit: accurate impact analysis before edits.
- Status:
  - Added framework-aware references in the reference provider.
  - Implemented semantic references for:
    - case references via `Type: case` -> `Value`
    - `Precases` / `Aftercases` list references
    - set `Cases -> Case` references
    - Gherkin references (`Given`/`Then`/`And`/`But`/`When`)
    - environment references (`Environment`, `Inherit`)
    - role references (`Role` / `role`)
  - Falls back to generic text-based reference search when context does not match framework semantics.

### 5) Safe semantic rename (scoped) (Implemented)

- Rename case/environment/role across only framework-relevant fields.
- Avoid replacing unrelated same-text values.
- Example:
  - renaming a case updates `Value`, `Precases`, `Aftercases`, set `Case`, etc.
- Benefit: reliable refactoring across test suites.
- Status:
  - Rename provider detects semantic context (case, step, environment, role, or generic).
  - Scoped rewrites apply only to framework-appropriate locations for that symbol kind.
  - Generic fallback keeps previous behavior for unmatched contexts.

### 6) Hover documentation (Implemented)

- On action `Type` and condition/assert operators, show:
  - expected fields
  - brief behavior notes
  - mini examples
- On symbols (case/env/role), show definition location and short context.
- Benefit: discoverability without leaving editor.
- Status:
  - Added YAML hover provider with framework-aware content.
  - Implemented hovers for:
    - action `Type` values (broad runtime action coverage, summary + required keys)
    - `Operation` values
    - assert `Type` values
    - case/step/environment/role symbols with quick definition/reference counts

## Nice-to-have Advanced Features

- Quick fixes / code actions:
  - "Add missing required keys"
  - "Create missing referenced case"
  - "Create missing environment"
- Outline/workspace symbols:
  - list cases, sets, environments, roles for quick navigation
- Dead reference checks:
  - undefined references
  - unused cases/environments/roles
- Status:
  - Implemented quick fix for diagnostics: "Add missing required key" for action validation errors.
  - Implemented YAML document outline symbols for cases/sets, environments, and roles.
  - Implemented workspace symbol provider for cross-file navigation of cases/sets, environments, apps, and roles.
  - Implemented quick fixes: "Create missing referenced case" and "Create missing environment".
  - Implemented dead-reference diagnostics for case/environment/role symbols.
  - Implemented unused diagnostics for environment/role symbols.
  - Removed unused-case diagnostics intentionally (entry-point cases like `testray execute CaseOne` are valid with zero references).
  - Added CodeLens on top-level case definitions showing reference counts (clickable when references exist).
  - Added role inlay hints for `$AND_CLI_<VAR>$` and `$AND_CLI_MAINROLE$` in `Role:` values.

## Suggested Implementation Order

1. Context-aware autocomplete + framework-aware go-to-definition
2. Schema-aware diagnostics
3. Semantic references + semantic rename scoping
4. Hover docs + quick fixes

## Optional Next Slice (Practical Start)

Implement first:
- completion for `Type: case` -> `Value`
- completion for `Environment` / `Inherit`
- completion for `Role`

Reuse current workspace YAML scanning and symbol indexing to keep implementation incremental.
