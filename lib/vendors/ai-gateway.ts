import { z } from "zod";

const toolCallSchema = z.object({
  type: z.literal("function_call"), call_id: z.string().min(1),
  name: z.string().min(1), arguments: z.string(),
});
const responseSchema = z.object({
  status: z.literal("completed"),
  model: z.string().optional(),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  }).passthrough()),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).optional(),
});

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type GatewayMessage = { role: string; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };

export async function createGatewayCompletion(input: {
  messages: GatewayMessage[];
  reasoningEffort: "low" | "medium";
  maxTokens: number;
  timeoutMs?: number;
  responseFormat?: Record<string, unknown>;
  tools?: Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
  toolChoice?: "auto" | "none";
}) {
  const key = process.env.AI_GATEWAY_API_KEY?.trim();
  if (!key) return null;
  const format = input.responseFormat?.type === "json_schema"
    ? structuredClone(input.responseFormat.json_schema) as { name: string; schema: Record<string, unknown> }
    : null;
  // Responses strict output requires every declared property, including arrays
  // that the local parser allows older saved results to omit.
  function requireProperties(value: unknown) {
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node.type === "object" && node.properties) node.required = Object.keys(node.properties);
    for (const child of Object.values(node)) requireProperties(child);
  }
  if (format) requireProperties(format.schema);
  const messages: Record<string, unknown>[] = input.messages.flatMap((message): Record<string, unknown>[] => {
    if (message.role === "assistant" && message.tool_calls?.length) {
      return [
        ...(message.content ? [{ role: "assistant", content: message.content }] : []),
        ...message.tool_calls.map(call => ({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments })),
      ];
    }
    if (message.role === "tool") return [{ type: "function_call_output", call_id: message.tool_call_id, output: message.content }];
    return [{ role: message.role, content: message.content }];
  });
  const response = await fetch("https://aigateway.inevitable.tech/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(Math.min(input.timeoutMs ?? 30_000, 30_000)),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `cx/gpt-6-luna-${input.reasoningEffort}`,
      input: messages,
      reasoning: { effort: input.reasoningEffort },
      max_output_tokens: input.maxTokens,
      stream: false,
      store: false,
      ...(format ? { text: { format: { type: "json_schema", name: format.name, strict: true, schema: format.schema } } }
        : input.responseFormat?.type === "json_object" ? { text: { format: { type: "json_object" } } } : {}),
      ...(input.tools ? { tools: input.tools.map(tool => ({ type: "function", ...tool.function })), tool_choice: input.toolChoice ?? "auto", parallel_tool_calls: false } : {}),
    }),
  });
  if (!response.ok) throw new Error(`AI gateway returned HTTP ${response.status}`);
  const parsed = responseSchema.parse(await response.json());
  const content = parsed.output.filter(item => item.type === "message")
    .flatMap(item => item.content ?? []).filter(item => item.type === "output_text")
    .map(item => item.text ?? "").join("").trim();
  const toolCalls = parsed.output.filter(item => item.type === "function_call").map(item => {
    const call = toolCallSchema.parse(item);
    if (!input.tools?.some(tool => tool.function.name === call.name) || input.toolChoice === "none") {
      throw new Error("AI gateway returned an unexpected tool call");
    }
    return { id: call.call_id, type: "function" as const, function: { name: call.name, arguments: call.arguments } };
  });
  if (toolCalls.length > 1) throw new Error("AI gateway returned parallel tool calls");
  if (!content && !toolCalls.length) throw new Error("AI gateway response missing content");
  if (format || input.responseFormat?.type === "json_object") JSON.parse(content);
  // Token counts are observable; an unreported charge is not recorded as free.
  console.info("ai_gateway_usage", { model: parsed.model, ...parsed.usage });
  return { finish_reason: "stop", message: { content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) } };
}

export async function generateGatewayFollowup(input: {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  schema: Record<string, unknown>;
  maxTokens: number;
}) {
  const result = await createGatewayCompletion({ ...input, reasoningEffort: "low",
    responseFormat: { type: "json_schema", json_schema: { name: "meeting_followup", schema: input.schema } },
  });
  return result?.message.content ?? null;
}
