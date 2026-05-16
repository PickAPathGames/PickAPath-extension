// // WORKING
// src/extension.ts
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { execFile, ExecFileException } from "child_process";

/* ============================================================
   COMMAND REGISTRY (EDITOR-ONLY, SHALLOW CHECKS)
   ============================================================ */

const CONFIG_COMMANDS = new Set([
  "title", "author", "version", "indent",
  "files", "var", "mvar", "define_goal",
  "save_vars", "cheat_mode"
]);
const VALID_COMMANDS = new Set([
    /* core.py */
    "go", "pause", "pic", "reach_goal", "bg_color", "body_color",
    "pick_once", "reset_pick", "pick_if", "single_pick",
    "tag", "go_file",
    "go_and_back", "go_back", "pick", "nl", "next", "end",

    /* lists.py */
    "list", "reverse", "sort_asc", "sort_des",

    /* logic.py */
    "if", "elseif", "else",

    /* persistance.py */
    "save_vars", "snapshot",

    /* stats.py */
    "permanent_stat", "remove_permanent_stat", "global_max_percentage",
    "stat_header", "stat_row", "stat_bar", "stat_vs", 
    "stat_break", "stat_block", "stat_block_end",

    /* strings.py */
    "upper", "lower", "naming", "turn_around",

    /* system.py */
    "cheat_mode", "save_checkpoint", "load_checkpoint", 
    "map_mode", "map_style", "author_mode",

    /* variables.py */
    "mvar", "winner", "loser", "add", "sub", "tvar", 
    "toggle", "entropy", "user_input", "average", "range",

    /* special / symbols */
    "%+", "%-", "ignore" 
]);

/* ============================================================
   DIAGNOSTIC COLLECTIONS (SEPARATED ON PURPOSE)
   ============================================================ */

const syntaxDiagnostics =
    vscode.languages.createDiagnosticCollection("pickapath-syntax");

const engineDiagnostics =
    vscode.languages.createDiagnosticCollection("pickapath-engine");

/* ============================================================
   EXTENSION ACTIVATION
   ============================================================ */

export function activate(context: vscode.ExtensionContext) {

    context.subscriptions.push(syntaxDiagnostics);
    context.subscriptions.push(engineDiagnostics);

    // --- Add the Color Provider Registration HERE ---
    context.subscriptions.push(
        vscode.languages.registerColorProvider('pickapath', {
            provideDocumentColors(document) {
                const colors: vscode.ColorInformation[] = [];
                const text = document.getText();
                const regEx = /#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})\b/g;
                let match;
                while ((match = regEx.exec(text))) {
                    const startPos = document.positionAt(match.index);
                    const endPos = document.positionAt(match.index + match[0].length);
                    const color = parseHexToVscColor(match[0]);
                    if (color) {
                        colors.push(new vscode.ColorInformation(new vscode.Range(startPos, endPos), color));
                    }
                }
                return colors;
            },
            provideColorPresentations(color) {
                return [new vscode.ColorPresentation(vscColorToHex(color))];
            }
        })
    );

    /* ---------- Live syntax checks (lightweight only) ---------- */

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc =>
            validateDocument(doc)
        ),

        vscode.workspace.onDidChangeTextDocument(event =>
            validateDocument(event.document)
        ),

        vscode.workspace.onDidCloseTextDocument(doc => {
            syntaxDiagnostics.delete(doc.uri);
            engineDiagnostics.delete(doc.uri);
        }),

        // vscode.workspace.onDidSaveTextDocument(doc => {
        //     if (doc.languageId !== "pickapath") return;
        //     vscode.commands.executeCommand("pickapath.runValidator");
        // }),
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (doc.languageId !== "pickapath") return;

            if (isConfigFile(doc)) {
                runConfigValidator();
            } else {
                vscode.commands.executeCommand("pickapath.runValidator");
            }
        }),

        vscode.commands.registerCommand("pickapath.toggleIgnore", () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const selections = editor.selections;

    editor.edit(editBuilder => {
        for (const selection of selections) {

            const startLine = selection.start.line;
            const endLine = selection.end.line;

            for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
                const line = document.lineAt(lineNumber);
                const text = line.text;

                if (!text.trim()) continue;

                const trimmed = text.trimStart();
                const indent = text.slice(0, text.length - trimmed.length);

                if (trimmed.startsWith("-ignore")) {
                    // Uncomment
                    const newText =
                        indent + trimmed.replace(/^-\s*ignore\s+/, "");
                    editBuilder.replace(line.range, newText);
                } else {
                    // Comment
                    const newText =
                        indent + "-ignore " + trimmed;
                    editBuilder.replace(line.range, newText);
                }
            }
        }
    });
})
);

    /* ---------- Engine validator command ---------- */

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "pickapath.runValidator",
            runEngineValidator
        )
    );
}

/* ============================================================
   INLINE SYNTAX VALIDATOR
   (NO VARIABLES, NO SEMANTICS)
   ============================================================ */

// function validateDocument(document: vscode.TextDocument) {
//     if (document.languageId !== "pickapath") return;
function validateDocument(document: vscode.TextDocument) {
    if (document.languageId !== "pickapath") return;
    if (isConfigFile(document)) {
        syntaxDiagnostics.delete(document.uri);
        return;
    }


    const errors: vscode.Diagnostic[] = [];

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const raw = line.text;
        const text = raw.trim();

        if (!text.startsWith("-")) continue;
        if (text.startsWith("-ignore")) continue;

        // const match = text.match(/^-([A-Za-z0-9_]+)/);
        const match = text.match(/^-([A-Za-z0-9_%+-]+)/);
        if (!match) continue;

        const command = match[1];
        if (VALID_COMMANDS.has(command)) continue;

        const start = raw.indexOf("-" + command);
        const range = new vscode.Range(
            new vscode.Position(i, start),
            new vscode.Position(i, start + command.length + 1)
        );

        errors.push(
            new vscode.Diagnostic(
                range,
                `Unknown command '-${command}'.`,
                vscode.DiagnosticSeverity.Error
            )
        );
    }

    syntaxDiagnostics.set(document.uri, errors);
}

/* ============================================================
   ENGINE VALIDATOR
   ============================================================ */

function runEngineValidator() {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) return;

    engineDiagnostics.clear();

    execFile(
        "python",
        ["-m", "engine.tools.validate", "--json"],
        { cwd: workspace.uri.fsPath,
            env: { 
            ...process.env, 
            "PYTHONPATH": workspace.uri.fsPath 
        }
         },
        (
            error: ExecFileException | null,
            stdout: string,
            stderr: string
        ) => {
            if (error && !stdout) {
                vscode.window.showErrorMessage(
                    "Pickapath validator failed:\n" +
                    (stderr || error.message)
                );
                return;
            }

            try {
                const data = JSON.parse(stdout);
                loadEngineDiagnosticsFromObject(data);
            } catch (err) {
                console.error("Validator output:", stdout);

                vscode.window.showErrorMessage(
                    "Pickapath validator crashed. See Output → Pickapath."
                );

                const output = vscode.window.createOutputChannel("Pickapath");
                output.appendLine(stdout);
                output.show(true);
            }

        }
    );
}

function runConfigValidator() {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) return;

    const configCandidates = [
        "scenes/config.txt",
        "scenes/config.pap"
    ];

    let configPath: string | null = null;

    for (const rel of configCandidates) {
        const full = path.join(workspace.uri.fsPath, rel);
        if (fs.existsSync(full)) {
            configPath = rel;
            break;
        }
    }

    if (!configPath) return;

    execFile(
        "python",
        ["-m", "engine.tools.validate_config", configPath, "--json"],
        { cwd: workspace.uri.fsPath },
        (error, stdout) => {
            if (error && !stdout) return;

            try {
                const diags = JSON.parse(stdout);
                loadConfigDiagnostics(diags, configPath);

            } catch {}
        }
    );
}

/* ============================================================
   ENGINE DIAGNOSTIC LOADER
   ============================================================ */

function loadEngineDiagnosticsFromObject(data: any) {
    const files = data.artifacts?.files;
    if (!files) return;

    for (const file in files) {

        // Do NOT attach scene diagnostics to config
        if (file.endsWith("config.txt") || file.endsWith("config.pap")) {
            continue;
        }

        const diags: vscode.Diagnostic[] = [];

        for (const d of files[file]) {
            const line = Math.max((d.line ?? 1) - 1, 0);
            const col = d.column ?? 0;
            const len = d.length ?? 1;

            const range = new vscode.Range(
                line,
                col,
                line,
                col + len
            );

            const severity =
                d.severity === "error"
                    ? vscode.DiagnosticSeverity.Error
                    : vscode.DiagnosticSeverity.Warning;

            const diag = new vscode.Diagnostic(
                range,
                d.message,
                severity
            );

            diag.code = d.code;
            diags.push(diag);
        }

        const uri = resolveSceneToUri(file);
        engineDiagnostics.set(uri, diags);
    }
}

function loadConfigDiagnostics(
    diags: any[],
    configPath: string
) {
    if (!Array.isArray(diags)) return;

    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) return;

    const diagnostics: vscode.Diagnostic[] = [];

    for (const d of diags) {
        const line = Math.max((d.line ?? 1) - 1, 0);

        const range = new vscode.Range(
            line,
            0,
            line,
            1
        );

        diagnostics.push(
            new vscode.Diagnostic(
                range,
                d.message,
                d.severity === "error"
                    ? vscode.DiagnosticSeverity.Error
                    : vscode.DiagnosticSeverity.Warning
            )
        );
    }

    const uri = vscode.Uri.file(
        path.join(workspace.uri.fsPath, configPath)
    );

    engineDiagnostics.set(uri, diagnostics);
}


/* ============================================================
   SCENE → FILE RESOLUTION
   ============================================================ */

function resolveSceneToUri(sceneName: string): vscode.Uri {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
        throw new Error("No workspace open");
    }

    const scenesDir = path.join(workspace.uri.fsPath, "scenes");

    const candidates = [
        `${sceneName}.pap`,
        `${sceneName}.pickapath`,
        `${sceneName}.txt`
    ];

    for (const name of candidates) {
        const fullPath = path.join(scenesDir, name);
        if (fs.existsSync(fullPath)) {
            return vscode.Uri.file(fullPath);
        }
    }

    return vscode.Uri.file(
        path.join(scenesDir, `${sceneName}.pap`)
    );
}


function isConfigFile(doc: vscode.TextDocument): boolean {
    const name = path.basename(doc.uri.fsPath).toLowerCase();
    return name === "config.txt" || name === "config.pap";
}


// Helper functions to handle the math
function parseHexToVscColor(hex: string): vscode.Color | undefined {
    // Handle short hex (#737)
    if (hex.length === 4) {
        const r = parseInt(hex[1] + hex[1], 16) / 255;
        const g = parseInt(hex[2] + hex[2], 16) / 255;
        const b = parseInt(hex[3] + hex[3], 16) / 255;
        return new vscode.Color(r, g, b, 1);
    }
    // Handle long hex (#d4af38)
    const r = parseInt(hex.substring(1, 3), 16) / 255;
    const g = parseInt(hex.substring(3, 5), 16) / 255;
    const b = parseInt(hex.substring(5, 7), 16) / 255;
    return new vscode.Color(r, g, b, 1);
}

function vscColorToHex(color: vscode.Color): string {
    const r = Math.round(color.red * 255).toString(16).padStart(2, '0');
    const g = Math.round(color.green * 255).toString(16).padStart(2, '0');
    const b = Math.round(color.blue * 255).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`.toUpperCase();
}

