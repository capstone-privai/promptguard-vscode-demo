import * as vscode from "vscode";
import { PromptGuardAgent } from "./agent/agentLoop";
import { OpenAIResponsesClient } from "./openai/responsesClient";
import { CredSweeperDetector } from "./privacy/detectorClient";
import { WorkspaceTools } from "./tools/workspaceTools";
import {
  presentPrivacyEvent,
  presentProcessingError,
  presentPromptSubmission,
  presentToolActivity,
  SAFE_COMMAND_ERROR_MESSAGE,
} from "./ui/presentation";

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
          await view.webview.postMessage({ type: "promptSubmitted", event: presentPromptSubmission(message.text) });
          await this.sendPrompt(view.webview, message.text);
        }
        await this.postStatus(view.webview);
      } catch {
        await view.webview.postMessage({ type: "error", message: SAFE_COMMAND_ERROR_MESSAGE });
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
        (event) => { void webview.postMessage({ type: "tool", event: presentToolActivity(event) }); },
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
        { privacy: (event) => { void webview.postMessage({ type: "privacy", event: presentPrivacyEvent(event) }); } },
        model,
      );
      const answer = await agent.run(text);
      await webview.postMessage({ type: "assistant", text: answer });
    } catch (error) {
      await webview.postMessage({ type: "error", message: presentProcessingError(error) });
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
    .empty-state { color: var(--vscode-descriptionForeground); padding: 10px 2px; font-size: 0.9em; }
    .event-card { border: 1px solid var(--vscode-panel-border); border-left: 3px solid var(--vscode-charts-green); border-radius: 6px; padding: 10px; }
    .event-header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 8px; }
    .event-title { font-size: 1em; font-weight: 600; }
    .event-source { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
    .phase-row { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
    .phase { border: 1px solid var(--vscode-panel-border); border-radius: 10px; color: var(--vscode-descriptionForeground); padding: 2px 6px; font-size: 0.8em; }
    .phase-arrow { color: var(--vscode-descriptionForeground); font-size: 0.8em; align-self: center; }
    .metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-bottom: 8px; }
    .metric { background: var(--vscode-textBlockQuote-background); border-radius: 4px; padding: 7px; }
    .metric-label { color: var(--vscode-descriptionForeground); font-size: 0.75em; }
    .metric-value { display: block; font-size: 1.15em; font-weight: 600; margin-top: 2px; }
    .finding { border-top: 1px solid var(--vscode-panel-border); padding-top: 8px; margin-top: 8px; }
    .finding-title { font-weight: 600; margin-bottom: 5px; }
    .detail-row { display: grid; grid-template-columns: 66px minmax(0, 1fr); gap: 6px; margin: 3px 0; font-size: 0.88em; }
    .detail-label { color: var(--vscode-descriptionForeground); }
    .detail-value { overflow-wrap: anywhere; }
    .action { color: var(--vscode-charts-green); font-weight: 600; }
    .activity { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; border-left: 3px solid var(--vscode-charts-blue); padding: 7px 8px; font-size: 0.86em; }
    .activity-action { font-weight: 600; }
    .activity-path { flex: 1 1 120px; overflow-wrap: anywhere; }
    .activity-status { color: var(--vscode-descriptionForeground); font-size: 0.8em; margin-left: auto; }
    .scan-empty { color: var(--vscode-descriptionForeground); padding: 6px 0; }
    .masked-characters { color: var(--vscode-descriptionForeground); font-size: 0.78em; margin-top: 8px; }
    textarea { box-sizing: border-box; width: 100%; min-height: 90px; resize: vertical; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 8px; }
    .composer { display: flex; flex-direction: column; gap: 8px; }
  </style>
</head>
<body>
  <h2>PromptGuard</h2>
  <div class="card">
    <div id="status" class="status" role="status">Checking API key…</div>
    <button id="setKey">Set API key</button>
    <button id="deleteKey">Delete API key</button>
  </div>
  <div id="history" role="log" aria-live="polite" aria-label="PromptGuard processing timeline"><div id="emptyState" class="empty-state">No processing activity yet.</div></div>
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
    function clearEmptyState() {
      const empty = document.getElementById('emptyState');
      if (empty) empty.remove();
    }
    function textNode(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      node.textContent = String(text);
      return node;
    }
    function appendHistory(node) {
      clearEmptyState();
      history.appendChild(node);
      node.scrollIntoView({block: 'nearest'});
    }
    function addMessage(kind, text) {
      const node = document.createElement('div');
      node.className = 'message ' + kind;
      if (kind === 'error') node.setAttribute('role', 'alert');
      node.textContent = (kind === 'user' ? 'You\\n' : kind === 'assistant' ? 'Agent\\n' : 'Error\\n') + text;
      appendHistory(node);
    }
    function addPromptSubmission(item) {
      const node = document.createElement('div');
      node.className = 'message user';
      addPhases(node, [item.phase]);
      node.appendChild(textNode('div', '', 'You'));
      node.appendChild(textNode('div', '', item.message));
      appendHistory(node);
    }
    function addPhases(parent, phases) {
      const row = document.createElement('div');
      row.className = 'phase-row';
      phases.forEach((phase, index) => {
        if (index > 0) row.appendChild(textNode('span', 'phase-arrow', '→'));
        row.appendChild(textNode('span', 'phase', phase));
      });
      parent.appendChild(row);
    }
    function addMetric(parent, label, value) {
      const node = document.createElement('div');
      node.className = 'metric';
      node.appendChild(textNode('span', 'metric-label', label));
      node.appendChild(textNode('span', 'metric-value', value));
      parent.appendChild(node);
    }
    function addDetail(parent, label, value, valueClass) {
      if (value === undefined || value === null || value === '') return;
      const row = document.createElement('div');
      row.className = 'detail-row';
      row.appendChild(textNode('span', 'detail-label', label + ':'));
      row.appendChild(textNode('span', 'detail-value' + (valueClass ? ' ' + valueClass : ''), value));
      parent.appendChild(row);
    }
    function addPrivacyEvent(item) {
      const node = document.createElement('section');
      node.className = 'event-card privacy';
      node.setAttribute('aria-label', item.title);
      const header = document.createElement('div');
      header.className = 'event-header';
      header.appendChild(textNode('span', 'event-title', item.title));
      header.appendChild(textNode('span', 'event-source', item.source));
      node.appendChild(header);
      addPhases(node, item.phases);
      const metrics = document.createElement('div');
      metrics.className = 'metrics';
      addMetric(metrics, 'Detected Secrets', item.detectedCount);
      addMetric(metrics, 'Masked Secrets', item.maskedCount);
      node.appendChild(metrics);
      if (item.sourceTool) addDetail(node, 'Source Tool', item.sourceTool);
      if (item.emptyMessage) node.appendChild(textNode('div', 'scan-empty', item.emptyMessage));
      item.findings.forEach((finding) => {
        const detail = document.createElement('div');
        detail.className = 'finding';
        detail.appendChild(textNode('div', 'finding-title', '#' + finding.number));
        addDetail(detail, 'Type', finding.type);
        addDetail(detail, 'Source', finding.source);
        addDetail(detail, 'Detector', finding.detector);
        addDetail(detail, 'Action', finding.action, 'action');
        addDetail(detail, 'Reason', finding.reason);
        node.appendChild(detail);
      });
      node.appendChild(textNode('div', 'masked-characters', 'Masked characters: ' + item.maskedCharacterCount));
      appendHistory(node);
    }
    function addToolActivity(item) {
      const node = document.createElement('div');
      node.className = 'activity';
      node.setAttribute('role', 'listitem');
      node.appendChild(textNode('span', 'phase', item.phase));
      node.appendChild(textNode('span', 'activity-action', item.action));
      node.appendChild(textNode('span', 'activity-path', item.path || 'Workspace'));
      node.appendChild(textNode('span', 'activity-status', item.status));
      appendHistory(node);
    }
    send.addEventListener('click', () => {
      const text = prompt.value;
      if (!text.trim()) return;
      prompt.value = '';
      vscode.postMessage({type:'sendPrompt', text});
    });
    window.addEventListener('message', event => {
      if (event.data.type === 'status') {
        document.getElementById('status').textContent = event.data.apiKeyConfigured ? 'API key configured' : 'API key not configured';
      } else if (event.data.type === 'promptSubmitted') {
        addPromptSubmission(event.data.event);
      } else if (event.data.type === 'assistant') {
        addMessage('assistant', event.data.text);
      } else if (event.data.type === 'error') {
        addMessage('error', event.data.message);
      } else if (event.data.type === 'privacy') {
        addPrivacyEvent(event.data.event);
      } else if (event.data.type === 'tool') {
        addToolActivity(event.data.event);
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
