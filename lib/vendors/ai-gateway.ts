import { z } from "zod";

const responseSchema = z.object({
  status: z.literal("completed"),
  model: z.string().optional(),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  })),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).optional(),
});

export async function generateGatewayFollowup(input: {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  schema: Record<string, unknown>;
  maxTokens: number;
}) {
  const key = process.env.AI_GATEWAY_API_KEY?.trim();
  if (!key) return null;

  // Responses strict output requires every declared property, including arrays
  // that the local parser allows older saved results to omit.
  const schema = structuredClone(input.schema);
  function requireProperties(value: unknown) {
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node.type === "object" && node.properties) {
      node.required = Object.keys(node.properties);
    }
    for (const child of Object.values(node)) requireProperties(child);
  }
  requireProperties(schema);

  const response = await fetch("https://aigateway.inevitable.tech/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "cx/gpt-6-luna-low",
      input: input.messages,
      reasoning: { effort: "low" },
      max_output_tokens: input.maxTokens,
      stream: false,
      store: false,
      text: { format: { type: "json_schema", name: "meeting_followup", strict: true, schema } },
    }),
  });
  if (!response.ok) throw new Error(`AI gateway returned HTTP ${response.status}`);
  const parsed = responseSchema.parse(await response.json());
  const content = parsed.output.filter(item => item.type === "message")
    .flatMap(item => item.content ?? [])
    .filter(item => item.type === "output_text")
    .map(item => item.text ?? "").join("").trim();
  if (!content) throw new Error("AI gateway response missing content");
  // The gateway reports token counts but not a dollar charge. Do not record
  // a fabricated OpenRouter cost or imply that unreported usage is free.
  console.info("meeting_followup_gateway_usage", { model: parsed.model, ...parsed.usage });
  return content;
}
