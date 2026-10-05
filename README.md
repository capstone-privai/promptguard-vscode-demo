# PromptGuard VS Code Demo V0

PromptGuard Demo V0 is an independent VS Code extension proof of concept. It masks hard secrets in a user's prompt and in supported local tool results **before** those values enter an OpenAI Responses API request.

This repository is separate from the earlier Codex Hook PoC. It does not use Codex CLI, Codex Hooks, or a local Responses proxy.

## What this proves

```text
VS Code side panel
  -> local CredSweeper scan (ML off)
  -> value-only placeholders
  -> OpenAI Responses API (store=false)
  -> local read/list/search/write tool
  -> local CredSweeper scan (ML off)
  -> sanitized function_call_output
  -> OpenAI Responses API
```

The OpenAI API key is held by VS Code `SecretStorage`. The extension does not write prompts, tool output, detected values, or the API key to a log file. Privacy events contain only source, count, type, and masked-character count.

## Setup and run

Requirements: VS Code 1.100+, Node.js/npm, Python 3.10+ on Windows, and an OpenAI API key.

```powershell
npm install
.\scripts\setup_detector.ps1
npm run compile
```

Open this repository in VS Code, press `F5`, and in the Extension Development Host:

1. Open a test workspace such as `examples/synthetic-workspace`.
2. Select the PromptGuard shield in the Activity Bar.
3. Select **Set API key**. The value is stored in VS Code SecretStorage and is never shown again.
4. Enter a coding task and select **Send**.
5. Observe privacy events and local tool activity in the side panel.

Setting the API key again replaces it; **Delete API key** removes it. The default model is `gpt-6-luna` and can be changed with `promptguard.model`. If the repository virtual environment is not used, set `promptguard.pythonPath` to a Python executable that has `credsweeper==1.18.5` installed.

Example task:

```text
Read config.txt, explain the database endpoint, and do not reveal credentials.
```

## Supported local tools

- `read_file`: UTF-8 files up to 1 MB, inside the first workspace folder.
- `list_files`: glob-based listing, capped at 200 files.
- `search_workspace`: literal search, capped by file/result limits.
- `write_file`: UTF-8 writes up to 100,000 characters after a modal user approval.

Paths are workspace-relative and checked lexically and against real filesystem ancestors. `.git`, `node_modules`, `.venv`, and `out` are excluded from listing/search. `run_command` is intentionally not implemented in V0.

## Privacy behavior

`python/detector_adapter.py` receives text through stdin and returns only normalized metadata:

```json
{"type":"PASSWORD","start":19,"end":28,"rule":"URL Credentials","fingerprint":"sha256..."}
```

It never returns the raw detected value. The TypeScript privacy gateway replaces spans locally. A one-way fingerprint gives equal values the same placeholder within one user task, for example `[PASSWORD_1]`. There is no vault and no restoration.

CredSweeper can de-duplicate equal credential values in one scan. After a value is positively detected, the adapter therefore covers every exact occurrence of that value in the same input. This adds no new credential rule; it prevents a repeated copy from remaining raw.

Detection failure, timeout, malformed output, or a missing Python environment blocks the request. There is no send-raw fallback.

### Observed CredSweeper 1.18.5 spans (ML off)

These were measured with `scripts/probe_detector.py`, not inferred:

| Synthetic form | Rule observed | Returned span |
|---|---|---|
| `DB_PASSWORD=...` | Password | value only |
| High-entropy API-key assignment | API / Key | key value only; adapter de-duplicates the span |
| `Authorization: Bearer ...` (32+ chars) | Bearer Authorization / Auth | token value only |
| PostgreSQL URL user/password | URL Credentials | password value only |
| MySQL URL user/password | URL Credentials | password value, but an additional generic `Secret` false positive was observed over `port/path` |
| HTTPS basic auth | URL Credentials | password value only |
| AWS secret-key assignment | Key / Secret | value only |
| JSON or docker-style password | Password | value only |

Short or obviously example-like API/Bearer values were filtered out. The MySQL observation shows why CredSweeper is useful but not a perfect runtime semantic parser: V0 honors its returned value spans and does not add an ad-hoc URL parser.

## Verification

Run:

```powershell
npm test
.\.venv\Scripts\python.exe .\python\test_detector_adapter.py
```

The Node tests assert in memory that:

- repeated equal values receive the same session placeholder;
- raw synthetic markers are absent from user-prompt and tool-output request objects immediately before transport;
- placeholders are present;
- `store` is forced to `false` by the API client;
- connection-string host, port, and database structure remain after value-only masking.

The Python test runs CredSweeper itself against user-prompt, password assignment, PostgreSQL URL, no-secret, repeated-secret, and multiple-secret cases. It checks offsets without writing detected values to logs.

Compilation and these offline tests do not prove a real OpenAI request. End-to-end cloud behavior requires the user's API key and is deliberately not automated or recorded.

### Shared metric-1 evaluation

The current extension privacy path can be evaluated with the team's synthetic
[`promptguard-data`](https://github.com/capstone-privai/promptguard-data) dataset and the scorer from the
`feat/evaluation-metric1` branch of `promptguard-demo-v0`. Clone all three repositories as siblings, then run:

```powershell
git clone https://github.com/capstone-privai/promptguard-data.git ..\promptguard-data
git clone --branch feat/evaluation-metric1 https://github.com/capstone-privai/promptguard-demo-v0.git ..\promptguard-demo-v0-eval
.\.venv\Scripts\python.exe .\scripts\evaluate_metric1.py
```

The adapter calls this repository's real `python/detector_adapter.py`; it does not reimplement the detector.
It scans the channels handled by this demo (`prompt`, `stdout`, `stderr`, and reserved `file_read`), preserves
session placeholder behavior, and writes only aggregate/span-offset results under ignored `evaluation-runs/`.
Do not add `--debug` to the shared evaluator because debug artifacts can contain raw synthetic input.

The first reproducible run and interpretation are in [docs/METRIC1_EVALUATION_KO.md](docs/METRIC1_EVALUATION_KO.md).
The dataset is a small, high-density synthetic pilot with `human_review=pending`, so its scores are regression
evidence, not production performance claims.

## Failure and storage boundaries

- Raw prompt/tool text exists transiently in extension and detector process memory because local scanning requires it.
- The webview displays the text the user typed locally, but the cloud client receives only the sanitized representation.
- Responses are sent with `store=false`. Tool turns replay prior response output in the next request rather than relying on a stored `previous_response_id`.
- API errors expose only HTTP status and optional OpenAI request ID; response bodies are not logged.
- The synthetic fixture deliberately contains fake credential-shaped strings. Never replace them with real secrets.

## Explicit limitations

This PoC demonstrates only that PromptGuard-controlled user prompts and supported local tool results can be masked before transmission. It does **not** prove:

- protection of all VS Code or other-extension network traffic;
- OS-level or enterprise DLP;
- perfect secret coverage, zero false positives, or zero false negatives;
- credential validity checking;
- task-aware privacy or utility preservation for every coding task;
- protection of model-generated output;
- command execution safety (there is no `run_command`);
- multi-root workspace isolation beyond using the first folder;
- macOS/Linux detector bootstrap (the supplied setup script is Windows PowerShell);
- production-ready file editing, rollback, diff review, or concurrent chat sessions.

## Repository status

- Branch: `main`
- GitHub remote: `https://github.com/capstone-privai/promptguard-vscode-demo.git` (public).
- Real API-key chat: implemented but not verified in automated tests.
