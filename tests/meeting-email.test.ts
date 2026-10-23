import { afterEach, describe, expect, it, vi } from "vitest";

import { buildMeetingEmail, splitTranscriptForNotes } from "@/lib/meeting-email";
import { sendResendEmail } from "@/lib/vendors/resend";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("meeting email", () => {
  it("attaches UTF8 notes and the complete timestamped original transcript", () => {
    const email = buildMeetingEmail({
      title: "产品 / 讨论",
      recipientEmail: "owner@example.com",
      from: "Tape <tape@inevitable.tech>",
      notes: "决定下周发布。",
      segments: [
        { startMs: 65000, speaker: "Jocy", text: "下周发布。" },
        { startMs: 3661000, speaker: null, text: "Sounds good." },
      ],
    });
    expect(email.to).toEqual(["owner@example.com"]);
    expect(email.attachments.map((a) => a.filename)).toEqual([
      "产品 讨论 notes.txt", "产品 讨论 transcript.txt",
    ]);
    expect(Buffer.from(email.attachments[0].content, "base64").toString("utf8"))
      .toContain("决定下周发布。");
    const transcript = Buffer.from(email.attachments[1].content, "base64").toString("utf8");
    expect(transcript).toContain("[01:05] Jocy: 下周发布。");
    expect(transcript).toContain("[61:01] Unknown speaker: Sounds good.");
  });

  it("splits long input without dropping any characters", () => {
    const transcript = "中文会议\n".repeat(12000);
    const chunks = splitTranscriptForNotes(transcript);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(transcript);
    expect(chunks.every((chunk) => chunk.length <= 24000)).toBe(true);
  });

  it("uses the same provider idempotency key on retry", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: "email-id" }));
    vi.stubGlobal("fetch", fetch);
    const email = buildMeetingEmail({
      title: "Meeting", recipientEmail: "owner@example.com", from: "tape@inevitable.tech",
      notes: "Notes", segments: [],
    });
    await expect(sendResendEmail(email, "meeting-email/job-id")).resolves.toBe("email-id");
    expect(fetch).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      headers: expect.objectContaining({ "Idempotency-Key": "meeting-email/job-id" }),
      body: JSON.stringify(email),
    }));
  });

  it("throws on provider failure without leaking the response body", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private recipient", { status: 429 })));
    await expect(sendResendEmail({ from: "tape@inevitable.tech", to: ["owner@example.com"], subject: "Meeting", text: "Ready", attachments: [] }, "meeting-email/job-id"))
      .rejects.toThrow("Resend email failed with 429");
  });
});
