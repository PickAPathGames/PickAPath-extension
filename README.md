# PickaPath Support

Authoring tools for the **PickaPath** interactive fiction engine. This extension provides a rich development environment for creating branching narratives.

## Features

*   **Smart Syntax Highlighting**: Custom grammar optimized for the PickaPath language.
*   **Live Validation**: Instant feedback on unknown commands and syntax errors.
*   **Color Previews**: Inline color boxes for hex codes used in text color.
*   **Engine Integration**: Run deep semantic checks directly via the Python engine (Ctrl+Shift+V).
*   **Toggle Ignore**: Easily comment out blocks of logic using `Ctrl+/`.

## Quick Start

1. Open a `.pap` or `.txt` file.
2. Ensure your Python engine is located in the `engine/` folder of your workspace.
3. Use **Ctrl+Shift+V** to trigger a full project validation.

## Commands

| Command | Keybinding | Description |
| :--- | :--- | :--- |
| `Run Validator` | `Ctrl+Shift+V` | Runs the Python-based engine validation. |
| `Toggle -ignore` | `Ctrl+/` | Toggles the `-ignore` prefix on selected lines. |

---
*Note: This extension requires a Python 3.x environment to run the advanced validator.*