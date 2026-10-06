import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIRequestError } from "../openai/responsesClient";
import { PrivacyEvent, PrivacyFinding } from "../privacy/gateway";
import {
  presentPrivacyEvent,
  presentProcessingError,
  presentPromptSubmission,
  presentToolActivity,
  SAFE_PROCESSING_ERROR_MESSAGE,
} from "../ui/presentation";

const RAW_SECRET = "synthetic-ui-secret-value-must-never-render";

function privacyEvent(overrides: Partial<PrivacyEvent> = {}): PrivacyEvent {
  return {
    source: "user_prompt",
    detectedCount: 0,
    maskedCount: 0,
    count: 0,
    types: [],
    maskedCharacterCount: 0,
    findings: [],
    ...overrides,
  };
}

test("prompt scan presents a stable empty state", () => {
  const view = presentPrivacyEvent(privacyEvent());
  assert.equal(view.title, "Prompt Scan");
  assert.equal(view.detectedCount, 0);
  assert.equal(view.maskedCount, 0);
  assert.equal(view.emptyMessage, "No secrets detected.");
  assert.deepEqual(view.findings, []);
  assert.equal(JSON.stringify(view).includes("undefined"), false);
  assert.equal(JSON.stringify(view).includes("null"), false);
});

test("prompt scan presents counts and multiple credential types", () => {
  const view = presentPrivacyEvent(privacyEvent({
    detectedCount: 2,
    maskedCount: 2,
    count: 2,
    types: ["API_KEY", "TOKEN"],
    maskedCharacterCount: 72,
    findings: [
      { type: "API_KEY", detector: "CredSweeper", rule: "API / Key", action: "MASK" },
      { type: "TOKEN", detector: "CredSweeper", rule: "Bearer Authorization", action: "MASK" },
    ],
  }));
  assert.equal(view.detectedCount, 2);
  assert.equal(view.maskedCount, 2);
  assert.deepEqual(view.findings.map((item) => item.type), ["API_KEY", "TOKEN"]);
  assert.deepEqual(view.findings.map((item) => item.action), ["MASK", "MASK"]);
  assert.deepEqual(view.findings.map((item) => item.reason), ["API / Key", "Bearer Authorization"]);
  assert.deepEqual(view.phases, ["SECRET_DETECTED", "SECRET_MASKED", "PROMPT_SANITIZED"]);
});

test("tool output scan presents source tool and masking count", () => {
  const view = presentPrivacyEvent(privacyEvent({
    source: "tool_output",
    sourceTool: "read_file",
    detectedCount: 1,
    maskedCount: 1,
    count: 1,
    maskedCharacterCount: 24,
    findings: [{ type: "PASSWORD", detector: "CredSweeper", rule: "Password", action: "MASK" }],
  }));
  assert.equal(view.title, "Tool Output Scan");
  assert.equal(view.sourceTool, "read_file");
  assert.equal(view.maskedCount, 1);
  assert.deepEqual(view.phases, ["TOOL_OUTPUT_RECEIVED", "SECRET_DETECTED", "SECRET_MASKED", "SAFE_OUTPUT"]);
});

test("file read activity preserves the existing path and status", () => {
  const view = presentToolActivity({ tool: "read_file", path: "src/client.ts", status: "completed" });
  assert.deepEqual(view, {
    action: "READ",
    path: "src/client.ts",
    status: "COMPLETED",
    phase: "FILE_READ",
  });
});

test("file read phase is emitted only after a completed read", () => {
  assert.equal(presentToolActivity({ tool: "read_file", path: "missing.txt", status: "started" }).phase, "TOOL_ACTIVITY");
  assert.equal(presentToolActivity({ tool: "read_file", path: "missing.txt", status: "failed" }).phase, "TOOL_ACTIVITY");
});

test("missing detector and reason metadata use safe fallbacks", () => {
  const view = presentPrivacyEvent(privacyEvent({
    detectedCount: 1,
    maskedCount: 1,
    count: 1,
    findings: [{ type: "", action: "MASK" }],
  }));
  assert.equal(view.findings[0]?.type, "Credential");
  assert.equal(view.findings[0]?.detector, undefined);
  assert.equal(view.findings[0]?.reason, undefined);
  assert.equal(JSON.stringify(view).includes("undefined"), false);
  assert.equal(JSON.stringify(view).includes("null"), false);
});

test("presentation projection never includes raw credential fields", () => {
  const contaminatedFinding = {
    type: "PASSWORD",
    detector: "CredSweeper",
    rule: "Password",
    action: "MASK",
    value: RAW_SECRET,
    fingerprint: RAW_SECRET,
  } as PrivacyFinding;
  const view = presentPrivacyEvent(privacyEvent({
    detectedCount: 1,
    maskedCount: 1,
    count: 1,
    findings: [contaminatedFinding],
  }));
  const submitted = presentPromptSubmission(`Inspect password=${RAW_SECRET}`);
  const serialized = JSON.stringify({ view, submitted, error: SAFE_PROCESSING_ERROR_MESSAGE });
  assert.equal(serialized.includes(RAW_SECRET), false);
  assert.equal(submitted.phase, "PROMPT_RECEIVED");
  assert.equal(submitted.message.includes(RAW_SECRET), false);
});

test("unknown source tool metadata is not rendered", () => {
  const view = presentPrivacyEvent(privacyEvent({ source: "tool_output", sourceTool: RAW_SECRET }));
  assert.equal(view.sourceTool, undefined);
  assert.equal(JSON.stringify(view).includes(RAW_SECRET), false);
});

test("aggregate count differences do not invent a masking failure", () => {
  const prompt = presentPrivacyEvent(privacyEvent({ detectedCount: 2, maskedCount: 1, count: 1 }));
  assert.deepEqual(prompt.phases, ["SECRET_DETECTED", "SECRET_MASKED", "PROMPT_SANITIZED"]);
});

test("OpenAI failures expose only actionable safe metadata", () => {
  assert.equal(
    presentProcessingError(new OpenAIRequestError("OPENAI_INITIAL_REQUEST", 401, "req_authentication123")),
    "OpenAI authentication failed during the initial model request (401). Re-enter the API key in PromptGuard. Request ID: req_authentication123.",
  );
  assert.equal(
    presentProcessingError(new OpenAIRequestError("OPENAI_TOOL_CONTINUATION", 429)),
    "OpenAI quota or rate limit reached during the tool-output continuation (429). Check API billing and usage limits.",
  );
  assert.equal(
    presentProcessingError(new OpenAIRequestError("OPENAI_INITIAL_REQUEST")),
    "OpenAI could not be reached during the initial model request. Check the network connection and try again.",
  );
  const unsafeRequestId = presentProcessingError(new OpenAIRequestError("OPENAI_INITIAL_REQUEST", 500, RAW_SECRET));
  assert.equal(unsafeRequestId.includes(RAW_SECRET), false);
  assert.equal(presentProcessingError(new Error(RAW_SECRET)), SAFE_PROCESSING_ERROR_MESSAGE);
});
