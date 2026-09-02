import nodemailer from "nodemailer";

// Outbound email, configured entirely by env. Two transports, checked in
// order - set one, not both:
//
//   1. SMTP (a free Gmail or Outlook account with an app password):
//        SMTP_HOST  smtp.gmail.com | smtp-mail.outlook.com
//        SMTP_PORT  465 (gmail) | 587 (outlook)
//        SMTP_USER  the full address
//        SMTP_PASS  the app password (never the real account password)
//      Gmail caps ~500 recipients/day and forces From to the account itself.
//
//   2. Mailtrap Send API:
//        MAILTRAP_TOKEN, MAIL_FROM (verified-domain sender),
//        optional MAILTRAP_INBOX_ID to route everything into a sandbox inbox.
//
// Neither configured = mail is OFF: sendMail says so instead of pretending.

type SendResult = { ok: true } | { ok: false; error: string };

function parseFrom(raw: string | undefined, fallbackEmail: string) {
  if (!raw) return { email: fallbackEmail, name: "Green Bergen" };
  const m = raw.match(/^(.*)<([^>]+)>\s*$/);
  if (m) return { email: m[2].trim(), name: m[1].trim() || "Green Bergen" };
  return { email: raw.trim(), name: "Green Bergen" };
}

async function sendViaSmtp(to: string, subject: string, text: string): Promise<SendResult> {
  const host = process.env.SMTP_HOST!;
  const user = process.env.SMTP_USER!;
  const from = parseFrom(process.env.MAIL_FROM, user);
  try {
    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 465),
      secure: (process.env.SMTP_PORT ?? "465") === "465",
      auth: { user, pass: process.env.SMTP_PASS },
    });
    await transport.sendMail({
      from: `"${from.name}" <${from.email}>`,
      to,
      subject,
      text,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `SMTP send failed: ${String(e).slice(0, 160)}` };
  }
}

async function sendViaMailtrap(to: string, subject: string, text: string): Promise<SendResult> {
  const token = process.env.MAILTRAP_TOKEN!;
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
        from: parseFrom(process.env.MAIL_FROM, "hello@demomailtrap.co"),
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

export async function sendMail(to: string, subject: string, text: string): Promise<SendResult> {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return sendViaSmtp(to, subject, text);
  }
  if (process.env.MAILTRAP_TOKEN) {
    return sendViaMailtrap(to, subject, text);
  }
  return { ok: false, error: "Email is not configured yet (set SMTP_* or MAILTRAP_TOKEN)." };
}
