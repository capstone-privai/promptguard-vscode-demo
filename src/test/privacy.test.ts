import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIResponsesClient, ResponseRequest } from "../openai/responsesClient";
import { PrivacyGateway } from "../privacy/gateway";
import { Detector } from "../privacy/types";

const SYNTHETIC_SECRET = "synthetic-secret-value";

class MarkerDetector implements Detector {
  public async scan(text: string): Promise<Array<{ type: string; start: number; end: number; rule: string; fingerprint: string }>> {
    const detections = [];
    let start = text.indexOf(SYNTHETIC_SECRET);
    while (start >= 0) {
      detections.push({ type: "PASSWORD", start, end: start + SYNTHETIC_SECRET.length, rule: "Password", fingerprint: "same-one-way-id" });
      start = text.indexOf(SYNTHETIC_SECRET, start + 1);
    }
    return detections;
  }
}

test("same secret receives the same session placeholder", async () => {
  const gateway = new PrivacyGateway(new MarkerDetector(), () => undefined);
  const result = await gateway.sanitize(`${SYNTHETIC_SECRET} and ${SYNTHETIC_SECRET}`, "user_prompt", "prompt.txt");
  assert.equal(result.text, "[PASSWORD_1] and [PASSWORD_1]");
});

test("user prompt and tool output are sanitized in cloud-bound requests", async () => {
  const requests: ResponseRequest[] = [];
  const client = new OpenAIResponsesClient("not-a-real-key", async (request) => {
    requests.push(request);
    return { id: `response-${requests.length}`, output_text: "ok" };
  });
  const gateway = new PrivacyGateway(new MarkerDetector(), () => undefined);
  const prompt = await gateway.sanitize(`Inspect password=${SYNTHETIC_SECRET}`, "user_prompt", "prompt.txt");
  await client.create({ model: "test-model", input: prompt.text });
  const tool = await gateway.sanitize(`DB_PASSWORD=${SYNTHETIC_SECRET}\nDB_HOST=db.internal`, "tool_output", "tool.txt");
  await client.create({ model: "test-model", input: [{ type: "function_call_output", call_id: "call-1", output: tool.text }] });
  const serialized = JSON.stringify(requests);
  assert.equal(serialized.includes(SYNTHETIC_SECRET), false);
  assert.equal(serialized.includes("[PASSWORD_1]"), true);
  assert.equal(requests.every((request) => request.store === false), true);
});

test("value-only span preserves connection structure", async () => {
  const original = "postgresql://admin:synthetic-secret-value@db.internal:5432/payments";
  const gateway = new PrivacyGateway(new MarkerDetector(), () => undefined);
  const result = await gateway.sanitize(original, "tool_output", "config.txt");
  assert.equal(result.text, "postgresql://admin:[PASSWORD_1]@db.internal:5432/payments");
});
