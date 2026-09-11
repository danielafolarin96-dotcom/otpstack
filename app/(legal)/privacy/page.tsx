import type { Metadata } from "next";
import { LegalSection, LegalTitle } from "../_components/legal-prose";
import { SUPPORT_EMAIL } from "@/lib/content/contact";

export const metadata: Metadata = { title: "Privacy Policy — OtpStack" };

export default function PrivacyPage() {
  return (
    <>
      <LegalTitle title="Privacy Policy" updatedAt="11 September 2026" />

      <LegalSection heading="What we collect">
        <ul>
          <li>Account details you provide: full name, email, username, and password (stored securely by our authentication provider — we never see or log your password in plain text).</li>
          <li>Wallet and order activity: top-ups, purchases, refunds, and the phone numbers/verification codes involved in each order.</li>
          <li>Technical data: IP address, used only for abuse and rate-limit enforcement.</li>
          <li>Support communications, if you contact us.</li>
        </ul>
        <p>
          We never receive or store your card details — Paystack&apos;s hosted checkout handles all
          payment data directly; OtpStack&apos;s servers never touch it.
        </p>
      </LegalSection>

      <LegalSection heading="How we use it">
        <ul>
          <li>To operate the service: process top-ups, purchase numbers on your behalf, and deliver verification codes to your dashboard.</li>
          <li>To prevent fraud and abuse, including rate limiting and account freezes.</li>
          <li>To provide support when you contact us.</li>
          <li>To comply with legal obligations.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Who we share it with">
        <ul>
          <li><strong>Paystack</strong> — processes wallet top-ups; receives what a standard checkout needs (your email, the amount), never your OtpStack password.</li>
          <li><strong>5sim.net</strong> — the number provider; a purchase requires us to request a number from them for the service/country you chose.</li>
          <li><strong>Supabase</strong> — our database and authentication provider, hosting your account and order data.</li>
        </ul>
        <p>We do not sell your personal data to anyone.</p>
      </LegalSection>

      <LegalSection heading="Data retention">
        <p>
          Verification codes are kept only long enough to display them to you and to support dispute
          resolution — not indefinitely. Wallet and order history is kept for as long as your account
          is active, and afterward for as long as needed for accounting and fraud-prevention records.
        </p>
      </LegalSection>

      <LegalSection heading="Your rights">
        <p>
          You can request a copy of your account data, or request that it be deleted (subject to
          records we&apos;re required to keep for accounting or fraud-prevention purposes), by
          emailing <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </LegalSection>

      <LegalSection heading="Cookies">
        <p>
          We use a single session cookie to keep you signed in. It&apos;s essential to the service —
          there are no third-party advertising or tracking cookies.
        </p>
      </LegalSection>

      <LegalSection heading="Children's privacy">
        <p>OtpStack is not intended for anyone under 18, and we don&apos;t knowingly collect data from minors.</p>
      </LegalSection>

      <LegalSection heading="Changes to this policy">
        <p>We may update this policy from time to time; continuing to use OtpStack after a change means you accept the update.</p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          Questions about this policy? Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </LegalSection>
    </>
  );
}
