import * as vscode from "vscode";
import { PromptGuardAgent } from "./agent/agentLoop";
import { OpenAIResponsesClient } from "./openai/responsesClient";
import { CredSweeperDetector } from "./privacy/detectorClient";
import { WorkspaceTools } from "./tools/workspaceTools";

const API_KEY_SECRET = "promptguard.openaiApiKey";

class PromptGuardViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "promptguard.chat";

  public constructor(private readonly context: vscode.ExtensionContext) {}

  private view?: vscode.WebviewView;

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.render();
    this.context.subscriptions.push(view.webview.onDidReceiveMessage(async (message: { type?: string; text?: string }) => {
      try {
        if (message.type === "ready") {
          await this.postStatus(view.webview);
        } else if (message.type === "setApiKey") {
          await this.setApiKey();
        } else if (message.type === "deleteApiKey") {
          await this.deleteApiKey();
        } else if (message.type === "sendPrompt" && typeof message.text === "string") {
          await this.sendPrompt(view.webview, message.text);
        }
        await this.postStatus(view.webview);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Extension command failed.";
        await view.webview.postMessage({ type: "error", message: detail });
      }
    }));
  }

  public refreshStatus(): void {
    if (this.view) {
      void this.postStatus(this.view.webview);
    }
  }

  public async setApiKey(): Promise<void> {
    const value = await vscode.window.showInputBox({
      title: "Set OpenAI API key",
      prompt: "Stored in VS Code SecretStorage and never written to settings or logs.",
      password: true,
      ignoreFocusOut: true,
    });
    if (value?.trim()) {
      await this.context.secrets.store(API_KEY_SECRET, value.trim());
      void vscode.window.showInformationMessage("PromptGuard API key stored securely.");
    }
    this.refreshStatus();
  }

  public async deleteApiKey(): Promise<void> {
    await this.context.secrets.delete(API_KEY_SECRET);
    void vscode.window.showInformationMessage("PromptGuard API key deleted.");
    this.refreshStatus();
  }

  private async sendPrompt(webview: vscode.Webview, text: string): Promise<void> {
    if (!text.trim()) {
      return;
    }
    const apiKey = await this.context.secrets.get(API_KEY_SECRET);
    if (!apiKey) {
      await webview.postMessage({ type: "error", message: "Set an OpenAI API key before sending." });
      return;
    }
    await webview.postMessage({ type: "busy", value: true });
    try {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        throw new Error("Open a workspace folder before starting the agent.");
      }
      const model = vscode.workspace.getConfiguration("promptguard").get<string>("model", "gpt-6-luna");
      const pythonPath = vscode.workspace.getConfiguration("promptguard").get<string>("pythonPath", "");
      const client = new OpenAIResponsesClient(apiKey);
      const detector = new CredSweeperDetector(this.context.extensionPath, pythonPath);
      const tools = new WorkspaceTools(
        root,
        (event) => { void webview.postMessage({ type: "tool", event }); },
        async (relativePath) => {
          const choice = await vscode.window.showWarningMessage(
            `PromptGuard agent wants to write ${relativePath}`,
            { modal: true, detail: "Review source control changes after allowing this Demo V0 operation." },
            "Allow write",
          );
          return choice === "Allow write";
        },
      );
      const agent = new PromptGuardAgent(
        client,
        detector,
        tools,
        { privacy: (event) => { void webview.postMessage({ type: "privacy", event }); } },
        model,
      );
      const answer = await agent.run(text);
      await webview.postMessage({ type: "assistant", text: answer });
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenAI request failed.";
      await webview.postMessage({ type: "error", message });
    } finally {
      await webview.postMessage({ type: "busy", value: false });
    }
  }

  private async postStatus(webview: vscode.Webview): Promise<void> {
    const configured = Boolean(await this.context.secrets.get(API_KEY_SECRET));
    await webview.postMessage({ type: "status", apiKeyConfigured: configured });
  }

  private render(): string {
    const nonce = Math.random().toString(36).slice(2);
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { padding: 10px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
    .card { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px; }
    .status { margin-bottom: 12px; color: var(--vscode-descriptionForeground); }
    button { margin-right: 6px; }
    #history { display: flex; flex-direction: column; gap: 8px; margin: 12px 0; }
    .message { border-radius: 6px; padding: 8px; white-space: pre-wrap; word-break: break-word; }
    .user { background: var(--vscode-textBlockQuote-background); }
    .assistant { border: 1px solid var(--vscode-panel-border); }
    .error { color: var(--vscode-errorForeground); border: 1px solid var(--vscode-inputValidation-errorBorder); }
    .event { color: var(--vscode-descriptionForeground); border-left: 3px solid var(--vscode-charts-blue); padding: 6px 8px; font-size: 0.9em; }
    .privacy { border-left-color: var(--vscode-charts-green); }
    textarea { box-sizing: border-box; width: 100%; min-height: 90px; resize: vertical; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 8px; }
    .composer { display: flex; flex-direction: column; gap: 8px; }
  </style>
</head>
<body>
  <h2>PromptGuard</h2>
  <div class="card">
    <div id="status" class="status">Checking API key…</div>
    <button id="setKey">Set API key</button>
    <button id="deleteKey">Delete API key</button>
  </div>
  <div id="history"></div>
  <div class="composer">
    <textarea id="prompt" placeholder="Ask PromptGuard to inspect or edit the current workspace…"></textarea>
    <button id="send">Send</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const status = document.getElementById('status');
    document.getElementById('setKey').addEventListener('click', () => {
      status.textContent = 'Opening secure API key input…';
      vscode.postMessage({type:'setApiKey'});
    });
    document.getElementById('deleteKey').addEventListener('click', () => {
      status.textContent = 'Deleting API key…';
      vscode.postMessage({type:'deleteApiKey'});
    });
    const history = document.getElementById('history');
    const prompt = document.getElementById('prompt');
    const send = document.getElementById('send');
    function addMessage(kind, text) {
      const node = document.createElement('div');
      node.className = 'message ' + kind;
      node.textContent = (kind === 'user' ? 'You\\n' : kind === 'assistant' ? 'Agent\\n' : 'Error\\n') + text;
      history.appendChild(node);
    }
    function addEvent(kind, text) {
      const node = document.createElement('div');
      node.className = 'event ' + kind;
      node.textContent = text;
      history.appendChild(node);
    }
    send.addEventListener('click', () => {
      const text = prompt.value;
      if (!text.trim()) return;
      addMessage('user', text);
      prompt.value = '';
      vscode.postMessage({type:'sendPrompt', text});
    });
    window.addEventListener('message', event => {
      if (event.data.type === 'status') {
        document.getElementById('status').textContent = event.data.apiKeyConfigured ? 'API key configured' : 'API key not configured';
      } else if (event.data.type === 'assistant') {
        addMessage('assistant', event.data.text);
      } else if (event.data.type === 'error') {
        addMessage('error', event.data.message);
      } else if (event.data.type === 'privacy') {
        const item = event.data.event;
        const label = item.source === 'user_prompt' ? 'User prompt' : 'Tool output';
        addEvent('privacy', '🔒 ' + label + ': ' + item.count + ' secret span(s) masked' + (item.types.length ? ' (' + item.types.join(', ') + ')' : ''));
      } else if (event.data.type === 'tool') {
        const item = event.data.event;
        addEvent('tool', '🛠 ' + item.tool + (item.path ? ': ' + item.path : '') + ' — ' + item.status);
      } else if (event.data.type === 'busy') {
        send.disabled = event.data.value;
        send.textContent = event.data.value ? 'Working…' : 'Send';
      }
    });
    vscode.postMessage({type:'ready'});
  </script>
</body>
</html>`;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PromptGuardViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PromptGuardViewProvider.viewType, provider),
    vscode.commands.registerCommand("promptguard.setApiKey", () => provider.setApiKey()),
    vscode.commands.registerCommand("promptguard.deleteApiKey", () => provider.deleteApiKey()),
  );
}

export function deactivate(): void {}

