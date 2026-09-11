import type { Metadata } from "next";
import Link from "next/link";
import { LegalSection, LegalTitle } from "../_components/legal-prose";
import { SUPPORT_EMAIL } from "@/lib/content/contact";

export const metadata: Metadata = { title: "FAQ — OtpStack" };

export default function FaqPage() {
  return (
    <>
      <LegalTitle title="Frequently asked questions" updatedAt="11 September 2026" />

      <LegalSection heading="What is OtpStack?">
        <p>
          OtpStack lets you rent a temporary phone number to receive a one-time SMS verification
          code, so you don&apos;t have to hand out your real number to sign up for something.
        </p>
      </LegalSection>

      <LegalSection heading="How do I fund my wallet?">
        <p>
          From Wallet &amp; top-up in your dashboard, choose an amount (₦500 minimum) and pay by
          card or bank transfer via Paystack. Your balance updates as soon as the payment is
          confirmed.
        </p>
      </LegalSection>

      <LegalSection heading="How long do I have to receive my code?">
        <p>
          10 minutes from the moment you buy a number. Your dashboard shows a live countdown while
          it&apos;s active.
        </p>
      </LegalSection>

      <LegalSection heading="What if I don't receive a code in time?">
        <p>
          The order is automatically cancelled and you&apos;re refunded in full to your wallet — no
          action needed on your end.
        </p>
      </LegalSection>

      <LegalSection heading="Can I cancel a purchase myself?">
        <p>
          Yes — while an order is still pending (before a code arrives), you can cancel it from your
          dashboard for the same full refund you&apos;d get on expiry.
        </p>
      </LegalSection>

      <LegalSection heading="Is my payment information safe?">
        <p>
          Yes. Paystack&apos;s hosted checkout handles your card or bank details directly — OtpStack
          never sees or stores them.
        </p>
      </LegalSection>

      <LegalSection heading="What services and countries are supported?">
        <p>
          A curated, growing list — check the catalog on the landing page or the &quot;Get a
          number&quot; page in your dashboard for what&apos;s currently available.
        </p>
      </LegalSection>

      <LegalSection heading="Is this allowed?">
        <p>
          OtpStack is for legitimate use — receiving your own verification codes. Using it for
          fraud, spam, or to violate another platform&apos;s terms is against our{" "}
          <Link href="/acceptable-use">Acceptable Use Policy</Link> and can get your account frozen
          or terminated.
        </p>
      </LegalSection>

      <LegalSection heading="How do I contact support?">
        <p>
          Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we&apos;ll get back to
          you.
        </p>
      </LegalSection>
    </>
  );
}
