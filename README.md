# TestRay YAML Extension

A VS Code/Cursor extension for YAML with TestRay-focused language features. It helps you navigate and validate large multi-file test suites, not just jump by plain text.

This repository is a fork and continues work started in the original project by Golovin Daniil.

## Purpose

- Navigate YAML test structures semantically (`Type: case`, `Precases`, `Aftercases`, `Case`, `Environment`, `Role`, Gherkin keys).
- Catch high-value authoring issues before runtime (missing references, duplicate case names, control-flow/FailCase shape problems).
- Improve editing speed for TestRay variables and symbols with completion, hover, and inlay hints.

The extension activates on `yaml` files (`onLanguage:yaml`).

## Features

| Area | What it does |
|------|---------------|
| Definition / References / Rename | Framework-aware symbol operations for cases, environments, roles, and step references; generic fallback when context is not recognized. |
| Diagnostics | Required keys by action type, missing case/environment/role references, duplicate top-level case names, control-flow checks (`timer`, `if`, `loop`), `FailCase` shape validation, and practical unused diagnostics. |
| Completion | Context-aware suggestions for action type, operation/assert enums, cases, environments, roles, and `$AND_CLI_<NAME>$` variable tokens. |
| Hover | Action/operator docs plus symbol summaries; `$AND_CLI_*` hovers show known `Vars` literals and whether names are sourced from `Greps`. |
| Inlay hints | Role hints and inline `$AND_CLI_*` token hints (`Vars` values, `Greps` runtime markers, `MAINROLE` runtime marker). |
| Symbols / CodeLens | Document/workspace symbols and reference-count CodeLens for top-level cases. |

For implementation notes and roadmap context, see [`SUGGESTIONS.md`](./SUGGESTIONS.md) and [`TESTRAY_EXTENSION_SUGGESTIONS.md`](./TESTRAY_EXTENSION_SUGGESTIONS.md).

## Requirements

- Node.js (build/test)
- VS Code `^1.86.0` compatible host (VS Code or Cursor)

## Run in Development

### 1) Install dependencies

```bash
npm install
```

### 2) Build once (required)

`package.json` points extension `main` to `dist/extension.js`, so build before launching:

```bash
npm run esbuild
```

For active development, keep watch mode in another terminal:

```bash
npm run esbuild-watch
```

### 3) Launch Extension Development Host

1. Open this repo in VS Code/Cursor.
2. Open Run and Debug.
3. Select `Run Extension`.
4. Press `F5`.

This opens a second editor window with the extension loaded.

### 4) Point the dev host to a test workspace (optional but recommended)

In `.vscode/launch.json`, the `args` array can include the folder you want to open in the dev host:

```json
"args": [
  "--extensionDevelopmentPath=${workspaceFolder}",
  "/absolute/path/to/TestRay-or-your-yaml-project"
]
```

### 5) Validate changes

```bash
npm run test:types
npx jest
```

## Package VSIX (optional)

```bash
npm run esbuild
npm run package
```

`npm run package` uses the local `@vscode/vsce` dev dependency.

Then install the generated `.vsix` from the Extensions view.

## Project layout

- `src/extension.ts`: activation and provider registration
- `src/yaml-*.ts`: provider implementations
- `src/core/*.ts`: shared parsing/indexing/validation helpers
- `dist/extension.js`: bundled runtime entrypoint

## License

See [`LICENSE.md`](./LICENSE.md).
