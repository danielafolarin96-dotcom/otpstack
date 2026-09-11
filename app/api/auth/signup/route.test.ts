import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { checkRateLimit } from "@/lib/rate-limit/check";

vi.mock("@/lib/rate-limit/check", () => ({
  checkRateLimit: vi.fn(),
  getClientIp: () => "1.2.3.4",
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

const signUp = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { signUp } }),
}));

function makeRequest(body: unknown) {
  return new Request("http://localhost:3000/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  username: "ada",
  password: "hunter22",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue(true);
});

describe("POST /api/auth/signup", () => {
  it("signs up when under the rate limit, passing full_name/username as user metadata", async () => {
    signUp.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });

    const response = await POST(makeRequest(VALID_BODY));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.hasSession).toBe(true);
    expect(signUp).toHaveBeenCalledWith({
      email: VALID_BODY.email,
      password: VALID_BODY.password,
      options: { data: { full_name: VALID_BODY.fullName, username: VALID_BODY.username } },
    });
  });

  it("reports hasSession: false without erroring when signup succeeds but no session comes back", async () => {
    signUp.mockResolvedValue({ data: { session: null }, error: null });

    const response = await POST(makeRequest(VALID_BODY));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.hasSession).toBe(false);
  });

  it("rejects with 429 and never calls Supabase once the per-IP rate limit is hit", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);

    const response = await POST(makeRequest(VALID_BODY));
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.error).toMatch(/too many/i);
    expect(signUp).not.toHaveBeenCalled();
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ key: "signup:ip:1.2.3.4" }),
    );
  });

  it("rejects with 400 when a required field is missing", async () => {
    const response = await POST(makeRequest({ email: "ada@example.com" }));

    expect(response.status).toBe(400);
    expect(signUp).not.toHaveBeenCalled();
  });

  it("passes through the Supabase error message and status 400 when signUp fails", async () => {
    signUp.mockResolvedValue({ data: { session: null }, error: { message: "Email already registered" } });

    const response = await POST(makeRequest(VALID_BODY));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("Email already registered");
  });
});
