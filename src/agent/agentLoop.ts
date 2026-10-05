import { OpenAIResponsesClient, ResponseOutputItem, responseText } from "../openai/responsesClient";
import { Detector } from "../privacy/types";
import { PrivacyEvent, PrivacyGateway } from "../privacy/gateway";
import { TOOL_DEFINITIONS, WorkspaceTools } from "../tools/workspaceTools";

export interface AgentCallbacks {
  privacy(event: PrivacyEvent): void;
}

export class PromptGuardAgent {
  private readonly gateway: PrivacyGateway;
  private readonly instructions = "You are a coding assistant operating only through the supplied workspace tools. Inspect files when needed, explain changes clearly, and request write_file only when a modification is necessary.";

  public constructor(
    private readonly client: OpenAIResponsesClient,
    private readonly detector: Detector,
    private readonly tools: WorkspaceTools,
    private readonly callbacks: AgentCallbacks,
    private readonly model: string,
  ) {
    this.gateway = new PrivacyGateway(detector, callbacks.privacy);
  }

  public async run(rawPrompt: string): Promise<string> {
    const prompt = await this.gateway.sanitize(rawPrompt, "user_prompt", "user-prompt.txt");
    let response = await this.client.create({ model: this.model, input: prompt.text, instructions: this.instructions, tools: TOOL_DEFINITIONS });
    for (let round = 0; round < 8; round += 1) {
      const calls = functionCalls(response.output ?? []);
      if (calls.length === 0) return responseText(response);
      const outputs: Array<Record<string, unknown>> = [];
      for (const call of calls) {
        let rawResult: string;
        try {
          const args = JSON.parse(call.arguments) as Record<string, unknown>;
          rawResult = await this.tools.execute(call.name, args);
        } catch (error) {
          rawResult = error instanceof Error ? `Tool error: ${error.message}` : "Tool error.";
        }
        const safe = await this.gateway.sanitize(rawResult, "tool_output", `tool-${call.name}.txt`);
        outputs.push({ type: "function_call_output", call_id: call.callId, output: safe.text });
      }
      response = await this.client.create({
        model: this.model,
        input: [...(response.output ?? []), ...outputs],
        instructions: this.instructions,
        tools: TOOL_DEFINITIONS,
      });
    }
    throw new Error("Agent stopped after reaching the 8-round tool safety limit.");
  }

}

interface FunctionCall {
  callId: string;
  name: string;
  arguments: string;
}

function functionCalls(items: ResponseOutputItem[]): FunctionCall[] {
  return items.flatMap((item) => item.type === "function_call" && typeof item.call_id === "string" && typeof item.name === "string" && typeof item.arguments === "string"
    ? [{ callId: item.call_id, name: item.name, arguments: item.arguments }]
    : []);
}
