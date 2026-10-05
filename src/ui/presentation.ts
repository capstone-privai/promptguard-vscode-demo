import { PrivacyEvent } from "../privacy/gateway";
import { ToolActivity, ToolName } from "../tools/workspaceTools";

export const PROMPT_SUBMITTED_MESSAGE = "Prompt submitted for local privacy scanning. Content hidden after submission.";
export const SAFE_COMMAND_ERROR_MESSAGE = "PromptGuard could not complete that action.";
export const SAFE_PROCESSING_ERROR_MESSAGE = "PromptGuard could not complete the request.";

export interface PrivacyFindingView {
  number: number;
  type: string;
  source: string;
  detector?: string;
  action: "MASK";
  reason?: string;
}

export interface PromptSubmissionView {
  phase: "PROMPT_RECEIVED";
  message: string;
}

export interface PrivacyEventView {
  title: "Prompt Scan" | "Tool Output Scan";
  source: "User Prompt" | "Tool Output";
  sourceTool?: string;
  detectedCount: number;
  maskedCount: number;
  maskedCharacterCount: number;
  findings: PrivacyFindingView[];
  phases: string[];
  emptyMessage?: string;
}

export interface ToolActivityView {
  action: "READ" | "LIST" | "SEARCH" | "WRITE";
  path?: string;
  status: "STARTED" | "COMPLETED" | "DENIED" | "FAILED";
  phase: "FILE_READ" | "TOOL_ACTIVITY";
}

const TOOL_ACTIONS: Record<ToolName, ToolActivityView["action"]> = {
  read_file: "READ",
  list_files: "LIST",
  search_workspace: "SEARCH",
  write_file: "WRITE",
};

const KNOWN_TOOLS = new Set<ToolName>(Object.keys(TOOL_ACTIONS) as ToolName[]);

export function presentPromptSubmission(_rawPrompt: string): PromptSubmissionView {
  return { phase: "PROMPT_RECEIVED", message: PROMPT_SUBMITTED_MESSAGE };
}

export function presentPrivacyEvent(event: PrivacyEvent): PrivacyEventView {
  const isPrompt = event.source === "user_prompt";
  const detectedCount = count(event.detectedCount, event.count);
  const maskedCount = count(event.maskedCount, event.count);
  const source = isPrompt ? "User Prompt" : "Tool Output";
  const eventFindings = Array.isArray(event.findings) ? event.findings : [];
  const findings = eventFindings.map((finding, index) => ({
    number: index + 1,
    type: displayText(finding.type, 64) ?? "Credential",
    source,
    ...(displayText(finding.detector, 64) ? { detector: displayText(finding.detector, 64) } : {}),
    action: "MASK" as const,
    ...(displayText(finding.rule, 120) ? { reason: displayText(finding.rule, 120) } : {}),
  }));
  const completedPhase = isPrompt ? "PROMPT_SANITIZED" : "SAFE_OUTPUT";
  const phases = [
    ...(!isPrompt ? ["TOOL_OUTPUT_RECEIVED"] : []),
    ...(detectedCount > 0 ? ["SECRET_DETECTED"] : []),
    ...(maskedCount > 0 ? ["SECRET_MASKED"] : []),
    completedPhase,
  ];
  return {
    title: isPrompt ? "Prompt Scan" : "Tool Output Scan",
    source,
    ...(knownTool(event.sourceTool) ? { sourceTool: event.sourceTool } : {}),
    detectedCount,
    maskedCount,
    maskedCharacterCount: count(event.maskedCharacterCount, 0),
    findings,
    phases,
    ...(detectedCount === 0
      ? { emptyMessage: "No secrets detected." }
      : maskedCount === 0
        ? { emptyMessage: "Masking was not completed." }
        : {}),
  };
}

export function presentToolActivity(event: ToolActivity): ToolActivityView {
  return {
    action: TOOL_ACTIONS[event.tool],
    ...(displayText(event.path, 240) ? { path: displayText(event.path, 240) } : {}),
    status: event.status.toUpperCase() as ToolActivityView["status"],
    phase: event.tool === "read_file" && event.status === "completed" ? "FILE_READ" : "TOOL_ACTIVITY",
  };
}

function count(value: number, fallback: number): number {
  if (Number.isInteger(value) && value >= 0) return value;
  return Number.isInteger(fallback) && fallback >= 0 ? fallback : 0;
}

function knownTool(value: string | undefined): value is ToolName {
  return typeof value === "string" && KNOWN_TOOLS.has(value as ToolName);
}

function displayText(value: string | undefined, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}
