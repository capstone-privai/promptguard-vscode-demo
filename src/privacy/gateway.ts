import { Detector, SanitizedText } from "./types";
import { redact, SessionPlaceholderRegistry } from "./redactor";

export interface PrivacyEvent {
  source: "user_prompt" | "tool_output";
  count: number;
  types: string[];
  maskedCharacterCount: number;
}

export class PrivacyGateway {
  private readonly placeholders = new SessionPlaceholderRegistry();

  public constructor(
    private readonly detector: Detector,
    private readonly emit: (event: PrivacyEvent) => void,
  ) {}

  public async sanitize(raw: string, source: PrivacyEvent["source"], detectorSource: string): Promise<SanitizedText> {
    const detections = await this.detector.scan(raw, detectorSource);
    const result = redact(raw, detections, this.placeholders);
    this.emit({
      source,
      count: result.detections.length,
      types: [...new Set(result.detections.map((item) => item.type))],
      maskedCharacterCount: result.maskedCharacterCount,
    });
    return result;
  }
}
