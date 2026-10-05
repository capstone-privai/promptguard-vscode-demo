export interface ResponseOutputItem {
  type: string;
  [key: string]: unknown;
}

export interface ResponseResult {
  id: string;
  output_text?: string;
  output?: ResponseOutputItem[];
}

export interface ResponseRequest {
  model: string;
  input: string | Array<Record<string, unknown>>;
  instructions?: string;
  tools?: Array<Record<string, unknown>>;
  previous_response_id?: string;
  store?: boolean;
}

export type ResponseTransport = (request: ResponseRequest, apiKey: string) => Promise<ResponseResult>;

export class OpenAIResponsesClient {
  public constructor(
    private readonly apiKey: string,
    private readonly transport: ResponseTransport = fetchTransport,
  ) {}

  public create(request: ResponseRequest): Promise<ResponseResult> {
    return this.transport({ ...request, store: false }, this.apiKey);
  }
}

async function fetchTransport(request: ResponseRequest, apiKey: string): Promise<ResponseResult> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const requestId = response.headers.get("x-request-id");
    throw new Error(`OpenAI request failed (${response.status})${requestId ? `, request id ${requestId}` : ""}`);
  }
  return (await response.json()) as ResponseResult;
}

export function responseText(response: ResponseResult): string {
  if (typeof response.output_text === "string" && response.output_text) {
    return response.output_text;
  }
  const pieces: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content as Array<Record<string, unknown>>) {
      if (content.type === "output_text" && typeof content.text === "string") {
        pieces.push(content.text);
      }
    }
  }
  return pieces.join("\n") || "The model returned no text.";
}

