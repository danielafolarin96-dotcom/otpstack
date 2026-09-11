import type { Metadata } from "next";
import Link from "next/link";
import { LegalSection, LegalTitle } from "../_components/legal-prose";
import { SUPPORT_EMAIL } from "@/lib/content/contact";

export const metadata: Metadata = { title: "Terms of Service — OtpStack" };

export default function TermsPage() {
  return (
    <>
      <LegalTitle title="Terms of Service" updatedAt="11 September 2026" />

      <LegalSection heading="1. Acceptance">
        <p>
          By creating an account or using OtpStack, you agree to these Terms of Service, our{" "}
          <Link href="/acceptable-use">Acceptable Use Policy</Link>, and our{" "}
          <Link href="/privacy">Privacy Policy</Link>. If you don&apos;t agree, don&apos;t use the
          service.
        </p>
      </LegalSection>

      <LegalSection heading="2. What OtpStack is">
        <p>
          OtpStack sells temporary phone numbers, sourced from a third-party provider, that you can
          use to receive a one-time SMS verification code. It is not a phone plan, a personal phone
          number, or a messaging service — a rented number is for receiving a single verification
          code and is not reusable or permanent.
        </p>
      </LegalSection>

      <LegalSection heading="3. Eligibility">
        <p>
          You must be at least 18 years old and able to form a binding contract to use OtpStack. You
          agree to provide accurate account information and to keep your login credentials secure.
        </p>
      </LegalSection>

      <LegalSection heading="4. Wallet and payments">
        <ul>
          <li>Your wallet is funded via Paystack; the minimum top-up is ₦500.</li>
          <li>
            Wallet balance is store credit for use within OtpStack — it is not a bank deposit, does
            not earn interest, and is not redeemable for cash except through a refund as described
            below.
          </li>
          <li>
            We never see or store your card details — Paystack&apos;s hosted checkout handles all
            payment data directly.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="5. Buying a number">
        <ul>
          <li>Prices are shown before purchase and are debited from your wallet at time of purchase.</li>
          <li>
            Once purchased, a number is held for you for 10 minutes. If no verification code arrives
            in that window, the order is automatically cancelled and refunded in full to your wallet.
          </li>
          <li>You can cancel a still-pending order yourself before the 10 minutes are up for the same refund.</li>
          <li>
            Once a code has been delivered, the purchase is complete and non-refundable — we have no
            control over whether the third-party service you&apos;re verifying with accepts the code.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="6. Acceptable use">
        <p>
          You agree to use OtpStack only for lawful purposes and in line with our{" "}
          <Link href="/acceptable-use">Acceptable Use Policy</Link>, which prohibits fraud, spam, and
          related abuse. Violating it may result in your account being frozen or terminated.
        </p>
      </LegalSection>

      <LegalSection heading="7. Account freezing and termination">
        <p>
          We may freeze an account — blocking new purchases and top-ups without deleting your data —
          while we investigate suspected abuse or a violation of these Terms. We may terminate an
          account outright for confirmed fraud, abuse, or illegal use. Any wallet balance remaining
          on a terminated account for a confirmed violation may be forfeited.
        </p>
      </LegalSection>

      <LegalSection heading="8. No warranty">
        <p>
          Numbers are sourced from a third-party provider and their availability, delivery speed, and
          acceptance by any given platform are outside our control. OtpStack is provided
          &quot;as is&quot; without warranties of any kind, to the extent permitted by law.
        </p>
      </LegalSection>

      <LegalSection heading="9. Limitation of liability">
        <p>
          To the maximum extent permitted by law, OtpStack&apos;s liability for any claim relating to
          the service is limited to the amount you paid us in the 3 months before the claim arose.
          We are not liable for indirect, incidental, or consequential damages.
        </p>
      </LegalSection>

      <LegalSection heading="10. Changes to these terms">
        <p>
          We may update these Terms from time to time. Continuing to use OtpStack after a change is
          posted means you accept the updated Terms.
        </p>
      </LegalSection>

      <LegalSection heading="11. Governing law">
        <p>These Terms are governed by the laws of Nigeria.</p>
      </LegalSection>

      <LegalSection heading="12. Contact">
        <p>
          Questions about these Terms? Email us at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </LegalSection>
    </>
  );
}
