import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIResponsesClient, ResponseRequest } from "../openai/responsesClient";
import { PrivacyGateway } from "../privacy/gateway";
import { Detector } from "../privacy/types";
import { CredSweeperDetector } from "../privacy/detectorClient";

const SYNTHETIC_SECRET = "synthetic-secret-value";

class MarkerDetector implements Detector {
  public readonly displayName = "Test detector";

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

test("privacy event exposes structured metadata without raw credential material", async () => {
  const events: Parameters<ConstructorParameters<typeof PrivacyGateway>[1]>[0][] = [];
  const gateway = new PrivacyGateway(new MarkerDetector(), (event) => events.push(event));
  await gateway.sanitize(`password=${SYNTHETIC_SECRET}`, "tool_output", "tool-read_file.txt", { sourceTool: "read_file" });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.detectedCount, 1);
  assert.equal(events[0]?.maskedCount, 1);
  assert.equal(events[0]?.count, 1);
  assert.equal(events[0]?.sourceTool, "read_file");
  assert.deepEqual(events[0]?.findings, [{ type: "PASSWORD", detector: "Test detector", rule: "Password", action: "MASK" }]);
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes(SYNTHETIC_SECRET), false);
  assert.equal(serialized.includes("same-one-way-id"), false);
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

test("detector startup failure is fail-closed", async () => {
  const detector = new CredSweeperDetector(process.cwd(), "Z:\\missing\\python.exe", 500);
  await assert.rejects(
    detector.scan(`password=${SYNTHETIC_SECRET}`, "prompt.txt"),
    /request blocked/,
  );
});
