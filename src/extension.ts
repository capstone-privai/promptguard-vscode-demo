import * as vscode from "vscode";
import { OpenAIResponsesClient, responseText } from "./openai/responsesClient";

const API_KEY_SECRET = "promptguard.openaiApiKey";

class PromptGuardViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "promptguard.chat";

  public constructor(private readonly context: vscode.ExtensionContext) {}

  private view?: vscode.WebviewView;

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.render();
    void this.postStatus(view.webview);
    view.webview.onDidReceiveMessage(async (message: { type?: string; text?: string }) => {
      if (message.type === "setApiKey") {
        await vscode.commands.executeCommand("promptguard.setApiKey");
      } else if (message.type === "deleteApiKey") {
        await vscode.commands.executeCommand("promptguard.deleteApiKey");
      } else if (message.type === "sendPrompt" && typeof message.text === "string") {
        await this.sendPrompt(view.webview, message.text);
      }
      await this.postStatus(view.webview);
    });
  }

  public refreshStatus(): void {
    if (this.view) {
      void this.postStatus(this.view.webview);
    }
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
      const model = vscode.workspace.getConfiguration("promptguard").get<string>("model", "gpt-6-luna");
      const client = new OpenAIResponsesClient(apiKey);
      const response = await client.create({ model, input: text });
      await webview.postMessage({ type: "assistant", text: responseText(response) });
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
    document.getElementById('setKey').addEventListener('click', () => vscode.postMessage({type:'setApiKey'}));
    document.getElementById('deleteKey').addEventListener('click', () => vscode.postMessage({type:'deleteApiKey'}));
    const history = document.getElementById('history');
    const prompt = document.getElementById('prompt');
    const send = document.getElementById('send');
    function addMessage(kind, text) {
      const node = document.createElement('div');
      node.className = 'message ' + kind;
      node.textContent = (kind === 'user' ? 'You\n' : kind === 'assistant' ? 'Agent\n' : 'Error\n') + text;
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
      } else if (event.data.type === 'busy') {
        send.disabled = event.data.value;
        send.textContent = event.data.value ? 'Working…' : 'Send';
      }
    });
  </script>
</body>
</html>`;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PromptGuardViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PromptGuardViewProvider.viewType, provider),
    vscode.commands.registerCommand("promptguard.setApiKey", async () => {
      const value = await vscode.window.showInputBox({
        title: "Set OpenAI API key",
        prompt: "Stored in VS Code SecretStorage and never written to settings or logs.",
        password: true,
        ignoreFocusOut: true,
      });
      if (value?.trim()) {
        await context.secrets.store(API_KEY_SECRET, value.trim());
        void vscode.window.showInformationMessage("PromptGuard API key stored securely.");
        provider.refreshStatus();
      }
    }),
    vscode.commands.registerCommand("promptguard.deleteApiKey", async () => {
      await context.secrets.delete(API_KEY_SECRET);
      void vscode.window.showInformationMessage("PromptGuard API key deleted.");
      provider.refreshStatus();
    }),
  );
}

export function deactivate(): void {}

