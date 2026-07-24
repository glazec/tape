import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of Use | Tape",
  description: "Terms that apply when authorized users access Tape.",
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Terms of use"
      title="A shared record needs shared responsibility."
      summary="These terms govern access to Tape by authorized workplace users."
      sections={[
        {
          title: "Using Tape",
          content: (
            <p>
              Tape is provided for authorized workplace use. Users must provide
              accurate account information, protect access to their Google
              account, and use the service only in compliance with applicable
              law and workplace policy.
            </p>
          ),
        },
        {
          title: "Recording responsibility",
          content: (
            <p>
              The user or organization that starts or schedules a recording is
              responsible for giving required notice, obtaining consent, and
              ensuring that recording, transcription, and sharing are lawful in
              every relevant jurisdiction.
            </p>
          ),
        },
        {
          title: "Meeting content",
          content: (
            <p>
              Users and their organizations retain their rights in meeting
              content. They give Tape permission to host, process, transmit, and
              display that content only as needed to provide the service,
              including capture, transcription, translation, search, export,
              sharing, support, and security.
            </p>
          ),
        },
        {
          title: "Acceptable use",
          content: (
            <p>
              Users may not access Tape without authorization, interfere with
              the service, upload malicious material, violate another
              person&apos;s rights, bypass access controls, or use meeting data
              for an unlawful purpose.
            </p>
          ),
        },
        {
          title: "Google services",
          content: (
            <p>
              Google sign in and optional Google Calendar access are governed by
              Google&apos;s applicable terms. A user may revoke Tape&apos;s
              Google access through Tape&apos;s calendar controls or their
              Google account settings.
            </p>
          ),
        },
        {
          title: "Service providers and availability",
          content: (
            <p>
              Tape relies on third party infrastructure and processing
              providers. Features may occasionally be unavailable, delayed, or
              changed. Tape may suspend access when necessary to protect users,
              data, or the service.
            </p>
          ),
        },
        {
          title: "Confidentiality and sharing",
          content: (
            <p>
              Users must treat meeting content according to their
              organization&apos;s confidentiality rules. A user who shares a
              meeting is responsible for choosing appropriate recipients and
              reviewing the access granted.
            </p>
          ),
        },
        {
          title: "Disclaimers and responsibility",
          content: (
            <p>
              Automated transcripts, translations, speaker labels, and answers
              may contain errors and should be checked before important use. To
              the extent permitted by law, Tape is provided without warranties
              and the IOSG Ventures team is not liable for indirect or
              consequential loss arising from use of the service.
            </p>
          ),
        },
        {
          title: "Ending access",
          content: (
            <p>
              A user may stop using Tape at any time. Workspace administrators
              may remove access, and Tape may end access for a material breach
              of these terms. Questions about access, deletion, or these terms
              can be sent to <a href="mailto:yiping@iosg.vc">yiping@iosg.vc</a>.
            </p>
          ),
        },
      ]}
    />
  );
}
