import type { Metadata } from "next";
import Link from "next/link";
import { LegalSection, LegalTitle } from "../_components/legal-prose";
import { SUPPORT_EMAIL } from "@/lib/content/contact";

export const metadata: Metadata = { title: "Acceptable Use Policy — OtpStack" };

export default function AcceptableUsePage() {
  return (
    <>
      <LegalTitle title="Acceptable Use Policy" updatedAt="11 September 2026" />

      <LegalSection heading="Purpose">
        <p>
          This policy sets out what you may not do with an OtpStack account or a number rented
          through it. It&apos;s part of our <Link href="/terms">Terms of Service</Link> — violating
          it is a violation of those Terms.
        </p>
      </LegalSection>

      <LegalSection heading="Prohibited uses">
        <p>You may not use OtpStack to:</p>
        <ul>
          <li>Commit or facilitate fraud, including payment fraud or identity misrepresentation.</li>
          <li>
            Send spam, or create or verify accounts in bulk for spam, scam, or manipulation
            purposes (e.g. fake reviews, fake engagement, promo/referral abuse).
          </li>
          <li>
            Verify accounts in order to harass, impersonate, stalk, or threaten another person.
          </li>
          <li>Evade a ban, suspension, or verification requirement imposed by another platform in bad faith.</li>
          <li>Engage in money laundering or any other financially illegal activity.</li>
          <li>Violate any applicable law, or the terms of service of the platform you&apos;re verifying with.</li>
          <li>
            Circumvent, probe, or abuse OtpStack&apos;s own systems — including rate limits, pricing,
            or the wallet/refund mechanism.
          </li>
          <li>Resell access to your OtpStack account or automate purchases at a scale intended to abuse the service rather than use it.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Consequences">
        <p>
          A suspected violation may result in your account being frozen — blocking new purchases and
          top-ups — while we investigate, without deleting your data. A confirmed violation may
          result in permanent account termination and forfeiture of any remaining wallet balance, per
          our <Link href="/terms">Terms of Service</Link>.
        </p>
      </LegalSection>

      <LegalSection heading="Reporting abuse">
        <p>
          If you believe an OtpStack account is being used to violate this policy, email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </LegalSection>
    </>
  );
}
