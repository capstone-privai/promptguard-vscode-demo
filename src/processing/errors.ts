export type ProcessingStage =
  | "PROMPT_SANITIZATION"
  | "INITIAL_RESPONSE_PROCESSING"
  | "TOOL_OUTPUT_SANITIZATION"
  | "CONTINUATION_RESPONSE_PROCESSING"
  | "AGENT_SAFETY_LIMIT";

const PROCESSING_STAGES = new Set<ProcessingStage>([
  "PROMPT_SANITIZATION",
  "INITIAL_RESPONSE_PROCESSING",
  "TOOL_OUTPUT_SANITIZATION",
  "CONTINUATION_RESPONSE_PROCESSING",
  "AGENT_SAFETY_LIMIT",
]);

export class PromptGuardProcessingError extends Error {
  public readonly code = "PROMPTGUARD_PROCESSING_ERROR";

  public constructor(public readonly stage: ProcessingStage) {
    super(`PromptGuard processing failed during ${stage}.`);
    this.name = "PromptGuardProcessingError";
  }
}

export function isPromptGuardProcessingError(error: unknown): error is PromptGuardProcessingError {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; stage?: unknown };
  return candidate.code === "PROMPTGUARD_PROCESSING_ERROR"
    && typeof candidate.stage === "string"
    && PROCESSING_STAGES.has(candidate.stage as ProcessingStage);
}
