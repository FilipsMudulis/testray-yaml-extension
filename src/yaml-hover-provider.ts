import * as path from "path";
import * as vscode from "vscode";
import { FilesContentMap, getFilesContentMap } from "./core/get-files-content-map";
import {
  collectWorkspaceCliVarDefinitions,
  findCliTokenAtColumn,
  MAINROLE_CLI_TOKEN,
} from "./core/vars-cli-and-greps";
import { getWorkspaceRoot } from "./utils/get-workspace-root";
import {
  detectSemanticRenameKind,
  getListParentKey,
  getParentCollectionKey,
  GHERKIN_KEYS,
  isCaseValueContext,
  isUnderCasesCollection,
  normalizeFrameworkValue,
  previousActionTypeIsCase,
  ROOT_NON_CASE_KEYS,
} from "./yaml-framework-context";

type ActionDoc = {
  summary: string;
  required: string[];
  example?: string;
};

const ACTION_DOCS: Record<string, ActionDoc> = {
  add_cookie: { summary: "Add browser cookie.", required: ["Name", "Value"] },
  assert: { summary: "Run assertion checks on variables/values.", required: ["Asserts"] },
  case: { summary: "Execute another case by name.", required: ["Value"] },
  back: { summary: "Navigate browser/app back.", required: [] },
  clear_field: { summary: "Clear input field value.", required: ["Strategy", "Id"] },
  click: { summary: "Click UI element using locator.", required: ["Strategy", "Id"] },
  click_and_hold: { summary: "Click and hold on UI element.", required: ["Strategy", "Id"] },
  click_coord: { summary: "Click by absolute coordinates.", required: [] },
  click_js: { summary: "Click element using JavaScript.", required: ["Strategy", "Id"] },
  clipboard: { summary: "Read clipboard content (supports greps).", required: [] },
  close_app: { summary: "Close current app session.", required: [] },
  collection_visible_for: { summary: "Validate element collection visibility duration.", required: ["Elements"] },
  command: { summary: "Run shell command on command role.", required: ["Value"] },
  context: { summary: "Switch driver context.", required: ["Value"] },
  driver_method: { summary: "Invoke low-level driver method.", required: [] },
  end_record: { summary: "Stop screen recording.", required: [] },
  execute_script: { summary: "Execute script in current context.", required: ["Value"] },
  get_attribute: { summary: "Read element attribute value.", required: ["Strategy", "Id"] },
  get_call: { summary: "Execute HTTP GET call.", required: ["Url"] },
  get_contexts: { summary: "List available driver contexts.", required: [] },
  get_current_context: { summary: "Get currently active context.", required: [] },
  get_source: { summary: "Get current page source.", required: [] },
  get_text: { summary: "Read element text.", required: ["Strategy", "Id"] },
  get_timestamp: { summary: "Capture timestamp to var/file.", required: ["Format"] },
  get_url: { summary: "Read current URL.", required: [] },
  handle_ios_alert: { summary: "Handle iOS alert interaction.", required: ["Strategy", "Id"] },
  home_button: { summary: "Press device home button.", required: [] },
  if: { summary: "Conditional control-flow action.", required: ["If_Cases"] },
  launch_app: { summary: "Launch app by identifier.", required: ["Value"] },
  loop: { summary: "Run a case multiple times.", required: ["Case", "Times"] },
  maximize: { summary: "Maximize app/window.", required: [] },
  minimize: { summary: "Minimize app/window.", required: [] },
  navigate: { summary: "Navigate to URL/page.", required: ["Value"] },
  notifications: { summary: "Open notifications panel.", required: [] },
  operation: { summary: "Evaluate operation and store/assert result.", required: ["Operation"] },
  pause: { summary: "Low-level pause helper (usually via sleep).", required: ["Time"] },
  post_call: { summary: "Execute HTTP POST call.", required: ["Url"] },
  press: { summary: "Press element without click abstraction.", required: ["Strategy", "Id"] },
  reload_driver: { summary: "Reload driver session.", required: [] },
  reload_driver_with_new_window_handle: {
    summary: "Reload driver and attach to a new window handle.",
    required: [],
  },
  remove_attribute: { summary: "Remove element attribute.", required: ["Strategy", "Id", "Attribute"] },
  screenshot: { summary: "Capture screenshot.", required: [] },
  scroll_to: { summary: "Scroll to element.", required: ["Strategy", "Id"] },
  scroll_until_element_visible: {
    summary: "Scroll until target element becomes visible.",
    required: ["Strategy", "Id"],
  },
  send_keys: { summary: "Type keys to focused/target element.", required: ["Value"] },
  set_attribute: { summary: "Set element attribute value.", required: ["Strategy", "Id", "Attribute", "Value"] },
  set_env_var: { summary: "Set runtime environment variable.", required: ["Var", "Value"] },
  set_network: { summary: "Set network condition/profile.", required: ["Condition"] },
  set_orientation: { summary: "Set screen orientation.", required: ["Value"] },
  sleep: { summary: "Pause execution for seconds.", required: ["Time"] },
  state_checker: { summary: "Perform app/device state check.", required: ["Strategy", "Id", "Message", "Path"] },
  stop_driver: { summary: "Stop driver session.", required: [] },
  submit: { summary: "Submit form element.", required: ["Strategy", "Id"] },
  sync: { summary: "Synchronization barrier between actions.", required: [] },
  swipe_coord: { summary: "Swipe using coordinates.", required: ["StartX", "StartY"] },
  swipe_down: { summary: "Swipe down gesture on element.", required: ["Strategy", "Id"] },
  swipe_elements: { summary: "Swipe between two elements.", required: ["Element1", "Element2"] },
  swipe_on_element: { summary: "Swipe on a single element.", required: ["Strategy", "Id"] },
  swipe_up: { summary: "Swipe up gesture on element.", required: ["Strategy", "Id"] },
  switch_frame: { summary: "Switch into frame by id/locator/value.", required: [] },
  switch_window: { summary: "Switch active window/tab.", required: ["Value"] },
  tap_by_coord: { summary: "Tap by coordinates derived from element.", required: ["Strategy", "Id"] },
  terminate_app: { summary: "Terminate app by identifier.", required: ["Value"] },
  timer: { summary: "Start/end named timer in control flow.", required: ["Role"] },
  update_settings: { summary: "Update driver settings.", required: ["Value"] },
  visible: { summary: "Check element visibility.", required: ["Strategy", "Id"] },
  visible_for: { summary: "Check element remains visible for duration.", required: ["Strategy", "Id"] },
  visible_for_not_raise: {
    summary: "Visibility-for check without raising by default.",
    required: ["Strategy", "Id"],
  },
  wait_for: { summary: "Wait for element/condition.", required: ["Strategy", "Id"] },
  wait_for_attribute: {
    summary: "Wait until element attribute matches value.",
    required: ["Strategy", "Id", "Attribute", "Value"],
  },
  wait_for_page_to_load: { summary: "Wait for page ready state.", required: [] },
  wait_not_visible: { summary: "Wait until element is not visible.", required: ["Strategy", "Id"] },
  write_file: { summary: "Write value/content to file.", required: ["Value"] },
};

const OPERATION_DOCS: Record<string, string> = {
  visible: "Checks visibility state.",
  visible_for: "Checks if visible for a duration.",
  eq: "Equals comparison.",
  ne: "Not-equals comparison.",
  lt: "Less-than comparison.",
  gt: "Greater-than comparison.",
  le: "Less-or-equal comparison.",
  ge: "Greater-or-equal comparison.",
  contain: "Substring/list contains check.",
  n_contain: "Negative contains check.",
};

const ASSERT_TYPE_DOCS: Record<string, string> = {
  code: "Validate HTTP status code.",
  contain: "Assert value contains substring.",
  eq: "Assert values are equal.",
  ne: "Assert values are not equal.",
  lt: "Assert left value is less than right.",
  gt: "Assert left value is greater than right.",
  le: "Assert left value is <= right.",
  ge: "Assert left value is >= right.",
  n_contain: "Assert value does not contain substring.",
};

function getCurrentKey(document: vscode.TextDocument, position: vscode.Position): string | undefined {
  const prefix = document.lineAt(position).text.slice(0, position.character);
  const match = prefix.trimStart().match(/^-?\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
  return match?.[1];
}

function getWord(document: vscode.TextDocument, position: vscode.Position): string | undefined {
  const range = document.getWordRangeAtPosition(position, /[^ \{\}\[\]\,]+/);
  if (!range) {
    return undefined;
  }
  return normalizeFrameworkValue(document.getText(range));
}

function countCaseReferences(files: FilesContentMap, name: string): number {
  let count = 0;
  Object.values(files).forEach((lines) => {
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const indent = line.length - line.trimStart().length;
      const valueMatch = trimmed.match(/^Value\s*:\s*(.+)$/);
      if (valueMatch && normalizeFrameworkValue(valueMatch[1]) === name) {
        if (previousActionTypeIsCase(lines, index, indent)) {
          count += 1;
        }
      }
      const listMatch = trimmed.match(/^-\s*(.+)$/);
      if (listMatch && normalizeFrameworkValue(listMatch[1]) === name) {
        const parent = getParentCollectionKey(lines, index, indent);
        if (parent === "Precases" || parent === "Aftercases") {
          count += 1;
        }
      }
      const setCaseMatch = trimmed.match(/^Case\s*:\s*(.+)$/);
      if (setCaseMatch && normalizeFrameworkValue(setCaseMatch[1]) === name) {
        if (isUnderCasesCollection(lines, index, indent)) {
          count += 1;
        }
      }
    });
  });
  return count;
}

export class YamlHoverProvider implements vscode.HoverProvider {
  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    if (document.languageId !== "yaml") {
      return undefined;
    }

    const lineText = document.lineAt(position.line).text;
    const cliTok = findCliTokenAtColumn(lineText, position.character);
    if (cliTok) {
      const { varsValues, grepVarNames } = collectWorkspaceCliVarDefinitions(
        getFilesContentMap(getWorkspaceRoot())
      );
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**\`${cliTok.fullToken}\`**\n\n`);
      if (cliTok.fullToken === MAINROLE_CLI_TOKEN) {
        md.appendMarkdown(
          "Resolves to the case **main role** at runtime (`ENV[\"MAINROLE\"]` in TestRay).\n\n"
        );
      }
      const literals = varsValues.get(cliTok.varName);
      if (literals && literals.size > 0) {
        md.appendMarkdown(
          `**Vars** literals in workspace: ${[...literals].map((v) => `\`${v}\``).join(", ")}\n\n`
        );
      }
      if (grepVarNames.has(cliTok.varName)) {
        md.appendMarkdown(
          "Also (or only) set via **Greps** on an action (`- var:` under `Greps:`); value is filled at runtime.\n\n"
        );
      }
      if (
        (!literals || literals.size === 0) &&
        !grepVarNames.has(cliTok.varName) &&
        cliTok.fullToken !== MAINROLE_CLI_TOKEN
      ) {
        md.appendMarkdown(
          "No matching `Vars:` or `Greps` entry found in this workspace (may be environment, CLI, or parent case).\n\n"
        );
      }
      md.appendMarkdown("TestRay substitutes `$AND_CLI_<NAME>$` for vars loaded from case/set `Vars:` and from action **Greps**.");
      return new vscode.Hover(md);
    }

    const word = getWord(document, position);
    if (!word) {
      return undefined;
    }

    const currentKey = getCurrentKey(document, position);
    const listParentKey = getListParentKey(document, position);

    if (currentKey === "Type") {
      if (listParentKey === "Asserts") {
        const assertDoc = ASSERT_TYPE_DOCS[word];
        if (assertDoc) {
          return new vscode.Hover(new vscode.MarkdownString(`**Assert \`${word}\`**\n\n${assertDoc}`));
        }
      }

      const doc = ACTION_DOCS[word];
      if (doc) {
        const required = doc.required.length > 0 ? doc.required.join(", ") : "none";
        return new vscode.Hover(
          new vscode.MarkdownString(
            `**Action \`${word}\`**\n\n${doc.summary}\n\n- Required keys: ${required}`
          )
        );
      }
    }

    if (currentKey === "Operation") {
      const opDoc = OPERATION_DOCS[word];
      if (opDoc) {
        return new vscode.Hover(new vscode.MarkdownString(`**Operation \`${word}\`**\n\n${opDoc}`));
      }
    }

    if (currentKey === "Type" && listParentKey === "Asserts") {
      const assertDoc = ASSERT_TYPE_DOCS[word];
      if (assertDoc) {
        return new vscode.Hover(new vscode.MarkdownString(`**Assert \`${word}\`**\n\n${assertDoc}`));
      }
    }

    const kind = detectSemanticRenameKind(document, position);
    if (kind === "generic") {
      return undefined;
    }

    const files = getFilesContentMap(getWorkspaceRoot());
    const md = new vscode.MarkdownString();

    if (kind === "case") {
      const defs: string[] = [];
      Object.entries(files).forEach(([filePath, lines]) => {
        lines.forEach((line) => {
          const match = line.trim().match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
          if (!match) {
            return;
          }
          const indent = line.length - line.trimStart().length;
          if (indent === 0 && !ROOT_NON_CASE_KEYS.has(match[1]) && match[1] === word) {
            defs.push(filePath);
          }
        });
      });
      md.appendMarkdown(`**Case \`${word}\`**\n\n`);
      md.appendMarkdown(`- Definitions: ${defs.length}\n`);
      md.appendMarkdown(`- References: ${countCaseReferences(files, word)}\n`);
      if (defs[0]) {
        md.appendMarkdown(`- First definition file: \`${path.basename(defs[0])}\``);
      }
      return new vscode.Hover(md);
    }

    if (kind === "step") {
      let defs = 0;
      let refs = 0;
      Object.values(files).forEach((lines) => {
        lines.forEach((line) => {
          const stepMatch = line.trim().match(/^Step\s*:\s*(.+)$/);
          if (stepMatch && normalizeFrameworkValue(stepMatch[1]) === word) {
            defs += 1;
          }
          for (const key of GHERKIN_KEYS) {
            const m = line.trim().match(new RegExp(`^${key}\\s*:\\s*(.+)$`));
            if (m && normalizeFrameworkValue(m[1]) === word) {
              refs += 1;
            }
          }
        });
      });
      md.appendMarkdown(`**Step \`${word}\`**\n\n- Definitions: ${defs}\n- References: ${refs}`);
      return new vscode.Hover(md);
    }

    if (kind === "environment") {
      let defs = 0;
      let refs = 0;
      Object.values(files).forEach((lines) => {
        let inEnvironments = false;
        let envIndent = 0;
        lines.forEach((line, index) => {
          const trimmed = line.trim();
          const indent = line.length - line.trimStart().length;
          if (!inEnvironments && /^Environments\s*:\s*$/.test(trimmed)) {
            inEnvironments = true;
            envIndent = indent;
            return;
          }
          if (inEnvironments && indent <= envIndent && trimmed.length > 0) {
            inEnvironments = false;
          }
          if (inEnvironments) {
            const d = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
            if (d && d[1] === word) {
              defs += 1;
            }
          }
          const envRef = trimmed.match(/^Environment\s*:\s*(.+)$/);
          if (envRef && normalizeFrameworkValue(envRef[1]) === word) {
            refs += 1;
          }
          const list = trimmed.match(/^-\s*(.+)$/);
          if (list && normalizeFrameworkValue(list[1]) === word) {
            const parent = getParentCollectionKey(lines, index, indent);
            if (parent === "Inherit") {
              refs += 1;
            }
          }
        });
      });
      md.appendMarkdown(`**Environment \`${word}\`**\n\n- Definitions: ${defs}\n- References: ${refs}`);
      return new vscode.Hover(md);
    }

    if (kind === "role") {
      let defs = 0;
      let refs = 0;
      Object.values(files).forEach((lines) => {
        lines.forEach((line) => {
          const roleMatch = line.trim().match(/^(Role|role)\s*:\s*(.+)$/);
          if (!roleMatch) {
            return;
          }
          const values = normalizeFrameworkValue(roleMatch[2])
            .split(",")
            .map((part) => part.trim());
          if (values.includes(word)) {
            refs += 1;
            if (line.trim().startsWith("role:")) {
              defs += 1;
            }
          }
        });
      });
      md.appendMarkdown(
        `**Role \`${word}\`**\n\nRole is optional on many actions and can inherit from case/main role.\n\n- Mentions: ${refs}\n- Device role definitions: ${defs}`
      );
      return new vscode.Hover(md);
    }

    if (currentKey === "Value" && isCaseValueContext(document, position)) {
      return new vscode.Hover(new vscode.MarkdownString("`Value` resolves case name for `Type: case`."));
    }

    return undefined;
  }
}
