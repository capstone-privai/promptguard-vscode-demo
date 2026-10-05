export interface Detection {
  type: string;
  start: number;
  end: number;
  rule: string;
  fingerprint: string;
}

export interface SanitizedText {
  text: string;
  detections: Array<{ type: string; rule: string; placeholder: string }>;
  maskedCharacterCount: number;
}

export interface Detector {
  scan(text: string, source: string): Promise<Detection[]>;
}
