import { createClient } from "@/lib/supabase/server";
import { saveSmsSettings, setSmsFlag } from "./actions";

export const dynamic = "force-dynamic";

// THE TEXTING SERVICE, seen whole (migration 247, ported from MicFit's
// /platform/sms). One RPC, sms_admin_overview(), answers everything on this
// page: the switches and limits, whether Twilio's secrets are in Vault (the
// screen never holds a secret, only whether one exists), the numbers flagged
// as possible spam, and the last 200 texts. Plain forms and server actions,
// no client component: nothing here needs to react before Save is pressed.

type Settings = {
  enabled: boolean; test_mode: boolean;
  phone_per_hour: number; phone_per_day: number; phone_per_year: number;
  platform_per_day: number; flag_threshold: number;
  sender_name: string; allowed_countries: string[]; updated_at: string;
};

type Overview = {
  settings: Settings;
  provider: { account_sid: boolean; auth_token: boolean; messaging_service: boolean; from: boolean; configured: boolean };
  site_origin: string | null;
  last_24h: { sent: number; test: number; refused: number; failed: number };
  countries: { code: string; name: string; dial_code: string; example: string }[];
  flags: {
    phone: string; status: "flagged" | "blocked" | "cleared"; flagged_at: string;
    request_count: number; reviewed_at: string | null; note: string | null;
  }[];
  log: {
    at: string; phone: string; purpose: string; project: string | null; who: string | null;
    outcome: string; error: string | null; body: string | null;
  }[];
};

const OUTCOME: Record<string, string> = {
  sent: "Sent",
  test: "Test (not texted)",
  invalid_number: "Number not accepted",
  country_not_allowed: "Country not allowed",
  disabled: "Service off",
  blocked: "Blocked number",
  limit_phone_hour: "Number: hourly limit",
  limit_phone_day: "Number: daily limit",
  limit_phone_year: "Number: yearly limit",
  limit_platform_day: "Platform: daily limit",
  not_configured: "Twilio not set up",
  provider_error: "Twilio error",
};

const LIMITS: { key: keyof Settings; label: string }[] = [
  { key: "phone_per_hour", label: "Texts per number, per hour" },
  { key: "phone_per_day", label: "Texts per number, per day" },
  { key: "phone_per_year", label: "Texts per number, per year" },
  { key: "platform_per_day", label: "Most texts per day, whole platform (0 stops sending)" },
  { key: "flag_threshold", label: "Flag a number as possible spam at N requests a year" },
];

// The platform runs on New York time; the server may not.
const when = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  }).format(new Date(iso));

const DEFAULT_ORIGIN = "https://greenbergen.vercel.app";

export default async function SmsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const supabase = await createClient();
  const { data, error: rpcError } = await supabase.rpc("sms_admin_overview");
  const o = (data ?? null) as Overview | null;

  if (rpcError || !o?.settings) {
    return <p className="muted">Texting settings are for administrators.</p>;
  }

  const s = o.settings;
  // The account is two secrets; the sender is ONE of two - a Messaging
  // Service (preferred: its own number pool, registration and spend line, so
  // Green Bergen's traffic stays apart from anything else on the account) or
  // a bare number.
  const missing = [
    !o.provider.account_sid && "twilio_account_sid",
    !o.provider.auth_token && "twilio_auth_token",
    !o.provider.messaging_service && !o.provider.from && "twilio_messaging_service_sid (or twilio_from)",
  ].filter((x): x is string => Boolean(x));
  const configured = missing.length === 0;
  const sender = o.provider.messaging_service ? "the Messaging Service" : o.provider.from ? "the number in twilio_from" : null;
  const toReview = o.flags.filter((f) => f.status === "flagged").length;

  const tile = (label: string, n: number, sub: string) => (
    <div className="tile" style={{ cursor: "default" }}>
      <span className="tile-label">{label}</span>
      <span style={{ fontSize: 22, fontWeight: 800 }}>{n.toLocaleString()}</span>
      <span className="tile-sub">{sub}</span>
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <h1 style={{ fontSize: 24, margin: 0 }}>Texts</h1>
      {saved && <p className="banner" style={{ background: "var(--ok)" }}>Saved ✓</p>}
      {error && <p className="error small">{error}</p>}

      <div className="youband" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        {tile("Sent", o.last_24h.sent, "last 24 hours")}
        {tile("Test", o.last_24h.test, "logged, not texted")}
        {tile("Refused", o.last_24h.refused, "limits, blocks, bad numbers")}
        {tile("Failed", o.last_24h.failed, "Twilio errors or not set up")}
      </div>

      {!configured ? (
        <div className="card" style={{ display: "grid", gap: 6 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Twilio is not set up</h2>
          <p className="small" style={{ margin: 0 }}>
            Nothing can be texted until the account and a sender exist in Supabase, Project Settings, Vault:{" "}
            <code>twilio_account_sid</code> and <code>twilio_auth_token</code> (a subaccount of your own for Green Bergen is cleanest),
            then <code>twilio_messaging_service_sid</code> (starts MG, preferred) or <code>twilio_from</code> (a bare +1 number).
            Missing now: <strong>{missing.join(", ")}</strong>.
          </p>
          <p className="muted small" style={{ margin: 0 }}>
            Test mode works without them: every attempt is logged and counted, and the room is shown what would have gone.
          </p>
        </div>
      ) : s.test_mode ? (
        <p className="banner" style={{ margin: 0 }}>Twilio is set up, sending through {sender}. Switch test mode off below to start sending.</p>
      ) : null}

      <form action={saveSmsSettings} className="card" style={{ display: "grid", gap: 12 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Settings</h2>

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" id="sms-enabled" name="enabled" defaultChecked={s.enabled} />
            <label htmlFor="sms-enabled" className="small">Service on. The bid room can text a bidder his link.</label>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" id="sms-test-mode" name="test_mode" defaultChecked={s.test_mode} />
            <label htmlFor="sms-test-mode" className="small">Test mode. Log and count, but text nothing; the room is shown what would have gone.</label>
          </div>
        </div>

        <div style={{ display: "grid", gap: 0, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", columnGap: 14 }}>
          <div className="field">
            <label htmlFor="sms-sender-name">Sender name in the text</label>
            <input id="sms-sender-name" name="sender_name" className="input" maxLength={30} required defaultValue={s.sender_name} />
            <span className="muted" style={{ fontSize: 11 }}>&ldquo;{s.sender_name || "Green Bergen"}: your bid page is ready...&rdquo;</span>
          </div>
          <div className="field">
            <label htmlFor="sms-site-origin">Site origin (the host the bid link points to)</label>
            <input id="sms-site-origin" name="site_origin" className="input" type="url" inputMode="url"
              placeholder={DEFAULT_ORIGIN} defaultValue={o.site_origin ?? DEFAULT_ORIGIN} />
            <span className="muted" style={{ fontSize: 11 }}>The text links to {o.site_origin ?? DEFAULT_ORIGIN}/bid/&lt;token&gt;. No trailing slash.</span>
          </div>
        </div>

        <div style={{ display: "grid", gap: 0, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", columnGap: 14 }}>
          {LIMITS.map((l) => (
            <div className="field" key={l.key}>
              <label htmlFor={`sms-${l.key}`}>{l.label}</label>
              <input id={`sms-${l.key}`} name={l.key} className="input" type="number" inputMode="numeric"
                min={0} step={1} required defaultValue={String(s[l.key])} />
            </div>
          ))}
        </div>

        <fieldset style={{ border: "1px solid var(--soft)", borderRadius: 10, padding: "10px 14px", margin: 0, display: "grid", gap: 6 }}>
          <legend className="small" style={{ fontWeight: 600, padding: "0 6px" }}>Countries we text</legend>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            A number from anywhere else is refused before anything is sent. Match this list in Twilio, Messaging, Settings, Geo permissions,
            which stops texts this screen did not check.
          </p>
          {o.countries.map((c) => (
            <div key={c.code} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" id={`sms-country-${c.code}`} name="country" value={c.code}
                defaultChecked={s.allowed_countries.includes(c.code)} />
              <label htmlFor={`sms-country-${c.code}`} className="small">
                {c.name} <span className="muted">+{c.dial_code} · {c.example}</span>
              </label>
            </div>
          ))}
        </fieldset>

        <div className="btn-row">
          <button className="btn">Save</button>
          <span className="muted" style={{ fontSize: 11 }}>Last saved {when(s.updated_at)}. The new limits apply to the next request.</span>
        </div>
      </form>

      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h2 className="section-title" style={{ margin: 0 }}>Flagged numbers</h2>
          <span className="muted small">{toReview} to review</span>
        </div>
        {o.flags.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            None. A number is flagged once it makes {s.flag_threshold} requests in a year.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tasktable">
              <thead><tr><th>Number</th><th>Status</th><th>Requests</th><th>Flagged</th><th>Note</th><th></th></tr></thead>
              <tbody>
                {o.flags.map((f) => (
                  <tr key={f.phone}>
                    <td style={{ whiteSpace: "nowrap" }}>{f.phone}</td>
                    <td><span className={`chip${f.status === "cleared" ? "" : " warn"}`}>{f.status}</span></td>
                    <td>{f.request_count}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{when(f.flagged_at)}</td>
                    <td className="muted small">{f.note ?? ""}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {f.status !== "blocked" && (
                          <form action={setSmsFlag.bind(null, f.phone, "blocked")}>
                            <button className="btn ghost small">Block</button>
                          </form>
                        )}
                        {f.status !== "cleared" && (
                          <form action={setSmsFlag.bind(null, f.phone, "cleared")}>
                            <button className="btn ghost small">{f.status === "blocked" ? "Unblock" : "Clear"}</button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form action={setSmsFlag.bind(null, "", "blocked")} style={{ display: "flex", gap: 6, alignItems: "end", flexWrap: "wrap" }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="sms-block-phone">Block a number by hand</label>
            <input id="sms-block-phone" name="phone" className="input small" type="tel" inputMode="tel"
              placeholder="(201) 555-0134" required style={{ height: 30, width: 170, padding: "2px 6px" }} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="sms-block-note">Why</label>
            <input id="sms-block-note" name="note" className="input small" placeholder="optional"
              style={{ height: 30, width: 200, padding: "2px 6px" }} />
          </div>
          <button className="btn ghost small">Block</button>
        </form>
      </div>

      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h2 className="section-title" style={{ margin: 0 }}>Last 200 texts</h2>
          <span className="muted small">Every attempt, sent or refused. New York time.</span>
        </div>
        {o.log.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>Nothing yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tasktable">
              <thead><tr><th>When</th><th>Number</th><th>Purpose</th><th>Project</th><th>Who</th><th>Outcome</th><th>Error</th></tr></thead>
              <tbody>
                {o.log.map((l, i) => (
                  <tr key={`${l.at}-${i}`}>
                    <td style={{ whiteSpace: "nowrap" }}>{when(l.at)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {l.phone}
                      {l.body && (
                        <details>
                          <summary className="muted small" style={{ cursor: "pointer" }}>text</summary>
                          <div className="small" style={{ whiteSpace: "pre-wrap", maxWidth: 360 }}>{l.body}</div>
                        </details>
                      )}
                    </td>
                    <td>{l.purpose.replaceAll("_", " ")}</td>
                    <td>{l.project ?? ""}</td>
                    <td>{l.who ?? ""}</td>
                    <td>
                      <span className={`chip${l.outcome === "sent" || l.outcome === "test" ? "" : " warn"}`}>
                        {OUTCOME[l.outcome] ?? l.outcome}
                      </span>
                    </td>
                    <td className="muted small">{l.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
