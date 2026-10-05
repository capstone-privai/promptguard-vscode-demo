import * as vscode from "vscode";

const API_KEY_SECRET = "promptguard.openaiApiKey";

class PromptGuardViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "promptguard.chat";

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true };
    view.webview.html = this.render();
    void this.postStatus(view.webview);
    view.webview.onDidReceiveMessage(async (message: { type?: string }) => {
      if (message.type === "setApiKey") {
        await vscode.commands.executeCommand("promptguard.setApiKey");
      } else if (message.type === "deleteApiKey") {
        await vscode.commands.executeCommand("promptguard.deleteApiKey");
      }
      await this.postStatus(view.webview);
    });
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
    body { padding: 12px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
    .card { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px; }
    .status { margin-bottom: 12px; color: var(--vscode-descriptionForeground); }
    button { margin-right: 6px; }
  </style>
</head>
<body>
  <h2>PromptGuard</h2>
  <div class="card">
    <div id="status" class="status">Checking API key…</div>
    <button id="setKey">Set API key</button>
    <button id="deleteKey">Delete API key</button>
  </div>
  <p>Private agent UI scaffold is active.</p>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('setKey').addEventListener('click', () => vscode.postMessage({type:'setApiKey'}));
    document.getElementById('deleteKey').addEventListener('click', () => vscode.postMessage({type:'deleteApiKey'}));
    window.addEventListener('message', event => {
      if (event.data.type === 'status') {
        document.getElementById('status').textContent = event.data.apiKeyConfigured ? 'API key configured' : 'API key not configured';
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
      }
    }),
    vscode.commands.registerCommand("promptguard.deleteApiKey", async () => {
      await context.secrets.delete(API_KEY_SECRET);
      void vscode.window.showInformationMessage("PromptGuard API key deleted.");
    }),
  );
}

export function deactivate(): void {}

