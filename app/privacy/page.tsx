import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy | Tape",
  description:
    "How Tape accesses, uses, stores, and shares account, meeting, and Google Calendar data.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy policy"
      title="Your meetings remain your record."
      summary="This policy explains the information Tape handles to capture, transcribe, organize, and share meetings for your workspace."
      sections={[
        {
          title: "Who operates Tape",
          content: (
            <p>
              Tape is a workplace meeting product operated by the{" "}
              <a href="https://iosg.vc/">IOSG Ventures</a> team. Questions and
              privacy requests can be sent to{" "}
              <a href="mailto:yiping@iosg.vc">yiping@iosg.vc</a>.
            </p>
          ),
        },
        {
          title: "Information we collect",
          content: (
            <>
              <p>
                Account data includes the name, email address, and account
                identifier provided when you sign in with Google.
              </p>
              <p>
                Meeting data includes event details, meeting links, participant
                information, recordings, uploaded media, transcripts, speaker
                corrections, translations, screen share images, and content that
                users choose to share.
              </p>
              <p>
                Technical data may include browser and device information,
                security and audit logs, product events, error details, and a
                push notification identifier when notifications are enabled.
              </p>
            </>
          ),
        },
        {
          title: "Google user data",
          content: (
            <>
              <p>
                When a user connects Google Calendar, Tape requests read only
                access to calendar events. Tape uses event titles, times,
                attendees, and conference links to show calendar context, create
                meeting records, and schedule or repair meeting capture. OAuth
                tokens are stored in encrypted form and are removed from Tape
                when the calendar is disconnected.
              </p>
              <p>
                Google user data is used only to provide and improve these
                visible meeting features. It is not sold, used for advertising
                or credit decisions, or used to train generalized or
                non-personalized AI or machine learning models.
              </p>
              <p>
                Tape&apos;s use and transfer of information received from Google
                APIs will adhere to the{" "}
                <a href="https://developers.google.com/terms/api-services-user-data-policy">
                  Google API Services User Data Policy
                </a>
                , including the Limited Use requirements.
              </p>
            </>
          ),
        },
        {
          title: "How we use information",
          content: (
            <p>
              Tape uses information to authenticate users, connect calendars,
              capture meetings, store and synchronize media, produce transcripts
              and translations, support search and sharing, send requested
              reminders, protect the service, resolve failures, and improve user
              facing features.
            </p>
          ),
        },
        {
          title: "Service providers",
          content: (
            <p>
              Tape uses service providers only as needed to operate the product.
              These include Google for sign in and Calendar, Neon for
              authentication and database services, Cloudflare for media
              storage, Recall for meeting capture and calendar integration,
              ElevenLabs for transcription, OpenRouter for requested language
              and answer features, Inngest for background work, and optional
              OneSignal and PostHog services for notifications and product
              operations. Providers process data under their own terms and
              privacy commitments.
            </p>
          ),
        },
        {
          title: "Sharing and access",
          content: (
            <p>
              Meeting content is available to authorized workspace members and
              to named people a user explicitly shares it with. Workspace
              administrators may manage membership and sharing defaults. Tape
              may disclose information when required by law, to protect users or
              the service, or as part of a business transaction with appropriate
              safeguards.
            </p>
          ),
        },
        {
          title: "Retention and deletion",
          content: (
            <p>
              Tape keeps account and meeting data while it is needed to provide
              the service. Authorized users can delete meetings, which removes
              the meeting record and associated stored media. Users can
              disconnect Google Calendar to remove stored Calendar tokens.
              Account deletion and other data requests can be sent to{" "}
              <a href="mailto:yiping@iosg.vc">yiping@iosg.vc</a>. Limited
              backups, security logs, or records required by law may remain for
              a reasonable period.
            </p>
          ),
        },
        {
          title: "Protection and international processing",
          content: (
            <p>
              Tape uses access controls, encrypted transport, encrypted Google
              Calendar credentials, and authenticated media routes to protect
              information. No system is completely secure. Tape and its
              providers may process information in countries other than the one
              where a user lives.
            </p>
          ),
        },
        {
          title: "Changes",
          content: (
            <p>
              This policy may change when the product or legal requirements
              change. The effective date above will be updated, and material
              changes will be communicated through the product or another
              appropriate channel.
            </p>
          ),
        },
      ]}
    />
  );
}
