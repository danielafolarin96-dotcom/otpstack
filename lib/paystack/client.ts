import "server-only";

// Reference only — verify against current Paystack docs before relying on
// this in production; provider APIs change. Per AGENT.md's "Don't invent
// 5sim or Paystack API behavior" rule, this wraps exactly one endpoint
// (Transaction > Initialize) and nothing beyond what ARCHITECTURE.md
// describes.
const PAYSTACK_BASE_URL = "https://api.paystack.co";

interface InitializeTransactionParams {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}

interface InitializeTransactionResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

export async function initializeTransaction(
  params: InitializeTransactionParams,
): Promise<InitializeTransactionResponse> {
  const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: params.email,
      amount: params.amountKobo,
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: params.metadata,
    }),
  });

  const json = (await response.json()) as InitializeTransactionResponse;

  if (!response.ok || !json.status) {
    throw new Error(`Paystack initialize failed: ${json.message ?? response.statusText}`);
  }

  return json;
}
