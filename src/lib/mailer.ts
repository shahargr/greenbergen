// Outbound email via Mailtrap's Send API. Configured entirely by env:
//
//   MAILTRAP_TOKEN     - API token (Vercel env / .env.local; never in code)
//   MAIL_FROM          - sender, e.g. "Green Bergen <hello@greenbergen.com>"
//                        (must be on a Mailtrap-verified domain; their demo
//                        sender delivers only to the account owner's address)
//   MAILTRAP_INBOX_ID  - optional: set to a sandbox inbox id to route ALL
//                        mail into Mailtrap's test inbox instead of the world
//
// Missing token = mail is OFF: sendMail reports that instead of pretending.

type SendResult = { ok: true } | { ok: false; error: string };

function parseFrom(raw: string | undefined) {
  const fallback = { email: "hello@demomailtrap.co", name: "Green Bergen" };
  if (!raw) return fallback;
  const m = raw.match(/^(.*)<([^>]+)>\s*$/);
  if (m) return { email: m[2].trim(), name: m[1].trim() || "Green Bergen" };
  return { email: raw.trim(), name: "Green Bergen" };
}

export async function sendMail(
  to: string,
  subject: string,
  text: string,
): Promise<SendResult> {
  const token = process.env.MAILTRAP_TOKEN;
  if (!token) {
    return { ok: false, error: "Email is not configured yet (MAILTRAP_TOKEN missing)." };
  }

  const inbox = process.env.MAILTRAP_INBOX_ID;
  const url = inbox
    ? `https://sandbox.api.mailtrap.io/api/send/${inbox}`
    : "https://send.api.mailtrap.io/api/send";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: parseFrom(process.env.MAIL_FROM),
        to: [{ email: to }],
        subject,
        text,
        category: "greenbergen",
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Mail service said ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Could not reach the mail service: ${String(e).slice(0, 120)}` };
  }
}
