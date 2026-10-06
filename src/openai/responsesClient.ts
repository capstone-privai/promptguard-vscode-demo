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

export type OpenAIRequestStage = "OPENAI_INITIAL_REQUEST" | "OPENAI_TOOL_CONTINUATION";

export type ResponseTransport = (
  request: ResponseRequest,
  apiKey: string,
  stage: OpenAIRequestStage,
) => Promise<ResponseResult>;

export class OpenAIRequestError extends Error {
  public readonly stage: OpenAIRequestStage;
  public readonly status?: number;
  public readonly requestId?: string;

  public constructor(
    stage: OpenAIRequestStage,
    status?: number,
    requestId?: string,
  ) {
    const safeStage = stage === "OPENAI_TOOL_CONTINUATION"
      ? "OPENAI_TOOL_CONTINUATION"
      : "OPENAI_INITIAL_REQUEST";
    const safeStatus = typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
      ? status
      : undefined;
    const safeRequestId = requestId && /^req_[A-Za-z0-9_-]{1,120}$/.test(requestId) ? requestId : undefined;
    super(`OpenAI request failed during ${safeStage}${safeStatus ? ` (${safeStatus})` : ""}.`);
    this.name = "OpenAIRequestError";
    this.stage = safeStage;
    this.status = safeStatus;
    this.requestId = safeRequestId;
  }
}

export class OpenAIResponsesClient {
  public constructor(
    private readonly apiKey: string,
    private readonly transport: ResponseTransport = fetchTransport,
  ) {}

  public async create(
    request: ResponseRequest,
    stage: OpenAIRequestStage = "OPENAI_INITIAL_REQUEST",
  ): Promise<ResponseResult> {
    const safeStage = stage === "OPENAI_TOOL_CONTINUATION"
      ? "OPENAI_TOOL_CONTINUATION"
      : "OPENAI_INITIAL_REQUEST";
    try {
      return await this.transport({ ...request, store: false }, this.apiKey, safeStage);
    } catch (error) {
      if (error instanceof OpenAIRequestError) {
        throw new OpenAIRequestError(safeStage, error.status, error.requestId);
      }
      throw new OpenAIRequestError(safeStage);
    }
  }
}

async function fetchTransport(
  request: ResponseRequest,
  apiKey: string,
  stage: OpenAIRequestStage,
): Promise<ResponseResult> {
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
    throw new OpenAIRequestError(stage, response.status, requestId ?? undefined);
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
