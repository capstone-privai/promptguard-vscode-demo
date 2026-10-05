# PromptGuard VS Code Demo V0

An independent VS Code extension proof of concept for masking hard secrets in user prompts and supported local tool results before those values are sent to a cloud LLM.

This repository is intentionally separate from the earlier Codex Hook proof of concept. It does not use Codex CLI, Codex Hooks, or a local Responses proxy.

## Status

Initial extension scaffold only. Functional privacy and agent features are added in later commits.

## Development

1. Install Node.js and npm.
2. Run `npm install`.
3. Run `npm run compile`.
4. Open this folder in VS Code and press `F5`.

The activity bar contains a PromptGuard shield icon and opens the `Private Agent` side panel.

