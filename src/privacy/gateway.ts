import { Detector, SanitizedText } from "./types";
import { redact, SessionPlaceholderRegistry } from "./redactor";

export interface PrivacyFinding {
  type: string;
  detector?: string;
  rule?: string;
  action: "MASK";
}

export interface PrivacyEvent {
  source: "user_prompt" | "tool_output";
  sourceTool?: string;
  detectedCount: number;
  maskedCount: number;
  count: number;
  types: string[];
  maskedCharacterCount: number;
  findings: PrivacyFinding[];
}

export interface PrivacyEventContext {
  sourceTool?: string;
}

export class PrivacyGateway {
  private readonly placeholders = new SessionPlaceholderRegistry();

  public constructor(
    private readonly detector: Detector,
    private readonly emit: (event: PrivacyEvent) => void,
  ) {}

  public async sanitize(
    raw: string,
    source: PrivacyEvent["source"],
    detectorSource: string,
    context: PrivacyEventContext = {},
  ): Promise<SanitizedText> {
    const detections = await this.detector.scan(raw, detectorSource);
    const result = redact(raw, detections, this.placeholders);
    const detector = optionalText(this.detector.displayName);
    const findings: PrivacyFinding[] = result.detections.map((item) => {
      const rule = optionalText(item.rule);
      return {
        type: item.type,
        ...(detector ? { detector } : {}),
        ...(rule ? { rule } : {}),
        action: "MASK",
      };
    });
    const sourceTool = optionalText(context.sourceTool);
    this.emit({
      source,
      ...(sourceTool ? { sourceTool } : {}),
      detectedCount: detections.length,
      maskedCount: findings.length,
      count: findings.length,
      types: [...new Set(result.detections.map((item) => item.type))],
      maskedCharacterCount: result.maskedCharacterCount,
      findings,
    });
    return result;
  }
}

function optionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
