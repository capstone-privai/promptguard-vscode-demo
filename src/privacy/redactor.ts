import { Detection, SanitizedText } from "./types";

export class SessionPlaceholderRegistry {
  private readonly placeholders = new Map<string, string>();
  private readonly counters = new Map<string, number>();

  public placeholderFor(detection: Detection): string {
    const key = `${detection.type}:${detection.fingerprint}`;
    const existing = this.placeholders.get(key);
    if (existing) {
      return existing;
    }
    const next = (this.counters.get(detection.type) ?? 0) + 1;
    this.counters.set(detection.type, next);
    const placeholder = `[${detection.type}_${next}]`;
    this.placeholders.set(key, placeholder);
    return placeholder;
  }
}

export function redact(
  input: string,
  detections: Detection[],
  registry: SessionPlaceholderRegistry,
): SanitizedText {
  const valid = detections
    .filter((item) => Number.isInteger(item.start) && Number.isInteger(item.end) && item.start >= 0 && item.end <= input.length && item.start < item.end)
    .sort((left, right) => left.start - right.start || right.end - left.end);
  const accepted: Detection[] = [];
  let lastEnd = -1;
  for (const item of valid) {
    if (item.start >= lastEnd) {
      accepted.push(item);
      lastEnd = item.end;
    }
  }
  let text = input;
  let maskedCharacterCount = 0;
  const events: SanitizedText["detections"] = [];
  for (const item of accepted.reverse()) {
    const placeholder = registry.placeholderFor(item);
    text = `${text.slice(0, item.start)}${placeholder}${text.slice(item.end)}`;
    maskedCharacterCount += item.end - item.start;
    events.unshift({ type: item.type, rule: item.rule, placeholder });
  }
  return { text, detections: events, maskedCharacterCount };
}
