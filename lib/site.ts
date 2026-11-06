// What search engines and link previews say about OtpStack. One place, so
// the page titles, sitemap, robots file and structured data agree.
// Claims here must stay true: 130 active countries and 722 active services
// as of 6 Nov 2026 (see the countries/services tables). Update the copy if
// the catalog shrinks.

export const SITE_URL = "https://otpstack.com.ng";
export const SITE_NAME = "OtpStack";

// Kept under ~60 characters so Google shows it without cutting it off.
export const SITE_TITLE = "OtpStack: Virtual Numbers for OTP in 130 Countries";

// Kept under ~160 characters for the same reason.
export const SITE_DESCRIPTION =
  "Virtual numbers for WhatsApp, Telegram, TikTok and 700+ apps in 130 countries. Get your number in seconds, pay in naira, and get refunded if no code arrives.";

// Public pages worth indexing. Dashboard, admin, auth callbacks and the API
// are kept out (see app/robots.ts).
export const PUBLIC_PATHS = ["/", "/faq", "/signup", "/login", "/terms", "/privacy", "/acceptable-use"] as const;
