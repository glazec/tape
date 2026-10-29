import { afterEach, describe, expect, it, vi } from "vitest";
import { generateMeetingFollowup } from "@/lib/vendors/openrouter";

const { recordUsage } = vi.hoisted(() => ({ recordUsage: vi.fn() }));
vi.mock("@/lib/provider-usage", () => ({
  recordOpenRouterCompletionUsage: recordUsage,
}));

const source = {
  title: "Meeting",
  startedAt: null,
  segments: [
    { id: "one", speaker: "Alex", startMs: 0, text: "I will send the deck." },
  ],
};
const output = {
  todos: [
    {
      person: "Alex",
      text: "Alex will send the deck.",
      timing: null,
      evidence: [{ segmentId: "one", quote: "I will send the deck." }],
    },
  ],
  dynamics: [], research: [],
};
const completion = (result: unknown) =>
  Response.json({
    id: "generation",
    model: "google/gemini-3.8-flash",
    choices: [
      { finish_reason: "stop", message: { content: JSON.stringify(result) } },
    ],
    usage: { cost: 0.01 },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function setup() {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  vi.stubEnv("OPENROUTER_MODEL", "assistant-model");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("followup provider", () => {
  it("uses the tested model and full transcript with strict output and usage accounting", async () => {
    const fetch = setup().mockResolvedValue(completion(output));
    expect(await generateMeetingFollowup(source, "meeting-id")).toEqual(output);
    const request = JSON.parse(fetch.mock.calls[0][1].body);
    expect(request.model).toBe("google/gemini-3.8-flash");
    expect(request.reasoning).toEqual({ effort: "low" });
    expect(request.response_format.json_schema.strict).toBe(true);
    expect(request.response_format.json_schema.schema.required).toContain("research");
    expect(request.response_format.json_schema.schema.properties.research.items.required).toEqual(
      expect.arrayContaining(["question", "context", "evidenceToCollect", "evidence"]),
    );
    expect(request.messages[0].content).toContain(
      "Replace ALL personal and possessive pronouns",
    );
    expect(JSON.parse(request.messages[1].content)).toEqual(source);
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: "meeting-id",
        category: "assistant",
      }),
    );
  });

  it("retries invalid prose, then drops repeated pronoun items instead of saving them", async () => {
    const invalid = {
      ...output,
      todos: [
        { ...output.todos[0], text: "Alex says they will send the deck." },
      ],
    };
    const fetch = setup().mockImplementation(() => completion(invalid));
    await expect(generateMeetingFollowup(source)).resolves.toEqual({
      todos: [],
      dynamics: [], research: [],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(fetch.mock.calls[1][1].body).messages[0].content,
    ).toContain("validation failure");
  });

  it("recovers from a wrong evidence citation", async () => {
    const fetch = setup()
      .mockResolvedValueOnce(
        completion({
          ...output,
          todos: [
            {
              ...output.todos[0],
              evidence: [{ segmentId: "bad", quote: "invented" }],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(completion(output));
    expect(await generateMeetingFollowup(source)).toEqual(output);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps grounded items when one item still fails after the retry", async () => {
    const mixed = {
      todos: [
        output.todos[0],
        { ...output.todos[0], text: "Alex will send the deck to them." },
      ],
      dynamics: [], research: [],
    };
    setup().mockImplementation(() => completion(mixed));
    await expect(generateMeetingFollowup(source)).resolves.toEqual(output);
  });

  it("still fails when the provider never returns valid JSON", async () => {
    setup().mockImplementation(() =>
      Response.json({ choices: [{ finish_reason: "stop", message: { content: "not json" } }] }),
    );
    await expect(generateMeetingFollowup(source)).rejects.toThrow("explicit names");
  });

  it("never silently truncates long input", async () => {
    const fetch = setup();
    await expect(
      generateMeetingFollowup({
        ...source,
        segments: [{ ...source.segments[0], text: "x".repeat(400001) }],
      }),
    ).rejects.toThrow("too long");
    expect(fetch).not.toHaveBeenCalled();
  });
});
