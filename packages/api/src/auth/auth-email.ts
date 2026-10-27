// ─── Auth: email delivery ─────────────────────────────────────────────────────
// The one place auth mail leaves the server. Delivery is Resend over HTTPS,
// configured by RESEND_API_KEY and RESEND_FROM_EMAIL. Resend's shared sender
// (onboarding@resend.dev) only delivers to the Resend account's own address,
// so real users need RESEND_FROM_EMAIL on a domain verified with Resend.
//
// RESEND_API_BASE points delivery at another host. It exists for the end-to-end
// harness, which runs a local stand-in the way it does for Telegram
// (TELEGRAM_API_BASE): the real signup code is generated, stored and checked,
// and the test reads it from the message the stand-in received. It is not a
// way around verification, and it is left unset in every deployed environment.
//
// Codes, links and recipient addresses are never written to the log. When
// the provider refuses a message, the log says the status and the kind of
// error the provider named (an identifier such as validation_error), which is
// what diagnosing an unverified domain or a bad key needs, and nothing else.

import { errorLabel } from "./error-label";

// A send that has not answered by then is treated as failed, so a request
// never waits on the provider for longer than this.
export const EMAIL_SEND_TIMEOUT_MS = 10_000;
const SHARED_SENDER = "onboarding@resend.dev";
const IDENTIFIER = /^[a-z][a-z0-9_]{0,63}$/;

export interface AuthEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Resolves true only when the provider accepted the message. */
export type SendAuthEmail = (email: AuthEmail) => Promise<boolean>;

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export const sendAuthEmail: SendAuthEmail = async (email) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[AUTH EMAIL] RESEND_API_KEY is not set; no email was sent.");
    return false;
  }

  const from = process.env.RESEND_FROM_EMAIL || SHARED_SENDER;
  if (from === SHARED_SENDER && process.env.NODE_ENV === "production") {
    // Resend's shared sender only reaches the Resend account's own address.
    console.warn("[AUTH EMAIL] RESEND_FROM_EMAIL is not set; mail will only reach the Resend account owner.");
  }

  try {
    const base = (process.env.RESEND_API_BASE ?? "https://api.resend.com").replace(/\/+$/, "");
    const res = await fetch(`${base}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `Kio <${from}>`,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
      signal: AbortSignal.timeout(EMAIL_SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[AUTH EMAIL] Provider refused the message (status ${res.status}, ${await providerErrorKind(res)}).`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[AUTH EMAIL] Provider could not be reached (${errorLabel(error)}).`);
    return false;
  }
};

// The kind of error the provider named in its reply ({ name: "validation_error" }),
// or "unknown". Only an identifier is kept: the reply's message can quote an
// address.
async function providerErrorKind(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { name?: unknown };
    return typeof body?.name === "string" && IDENTIFIER.test(body.name) ? body.name : "unknown";
  } catch {
    return "unknown";
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function layout(heading: string, body: string) {
  return `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:40px 20px;background:#0a0a0a;color:#fff;border-radius:12px;">
      <h1 style="color:#00D9A3;margin-bottom:8px;">${heading}</h1>
      ${body}
    </div>
  `;
}

const P = 'style="color:#aaa;margin-bottom:24px;"';
const SMALL = 'style="color:#666;font-size:13px;margin-top:16px;"';
const BUTTON =
  'style="display:inline-block;background:#00D9A3;color:#000;padding:12px 28px;border-radius:999px;text-decoration:none;font-weight:700;margin-bottom:24px;"';

export function signupCodeEmail(to: string, code: string, minutes: number): AuthEmail {
  return {
    to,
    subject: "Your Kio verification code",
    text: `Your Kio verification code is ${code}. It expires in ${minutes} minutes. Enter it on the page where you started signing up. If you didn't ask for it, ignore this email and never share the code.`,
    html: layout(
      "Verify your email",
      `<p ${P}>Enter this code to finish creating your Kio account.</p>
       <p style="font-size:32px;letter-spacing:6px;font-weight:700;color:#fff;margin-bottom:24px;">${code}</p>
       <p ${SMALL}>This code expires in ${minutes} minutes and only works on the page where you started signing up. If you didn't ask for it, you can safely ignore this email. Never share this code.</p>`,
    ),
  };
}

export function existingAccountEmail(to: string, appUrl: string): AuthEmail {
  return {
    to,
    subject: "You already have a Kio account",
    text: `Someone tried to create a Kio account with this email, but you already have one. Sign in at ${appUrl}/signin, or reset your password at ${appUrl}/forgot-password. If this wasn't you, ignore this email.`,
    html: layout(
      "You already have an account",
      `<p ${P}>Someone tried to create a Kio account with this email address, but one already exists.</p>
       <a href="${appUrl}/signin" ${BUTTON}>Sign in</a>
       <p ${SMALL}>Forgot your password? <a href="${appUrl}/forgot-password" style="color:#00D9A3;">Reset it here</a>. If this wasn't you, you can safely ignore this email.</p>`,
    ),
  };
}

export function passwordResetEmail(to: string, name: string | null, resetUrl: string, minutes: number): AuthEmail {
  const safeName = escapeHtml(name ?? "there");
  return {
    to,
    subject: "Reset your Kio password",
    text: `We received a request to reset your Kio password. Open this link to choose a new one: ${resetUrl} It expires in ${minutes} minutes. If you didn't request this, ignore this email.`,
    html: layout(
      "Reset your password",
      `<p ${P}>Hi ${safeName}, we received a request to reset your Kio password.</p>
       <a href="${resetUrl}" ${BUTTON}>Reset Password</a>
       <p ${SMALL}>This link expires in ${minutes} minutes and works once. If you didn't request this, you can safely ignore this email.</p>`,
    ),
  };
}

export function googleAccountEmail(to: string, appUrl: string): AuthEmail {
  return {
    to,
    subject: "Sign in to Kio with Google",
    text: `We received a request to reset your Kio password, but your account signs in with Google and has no password. Go to ${appUrl}/signin and choose Continue with Google. If you didn't request this, ignore this email.`,
    html: layout(
      "Your account uses Google",
      `<p ${P}>We received a request to reset your Kio password. Your account signs in with Google, so it has no password to reset.</p>
       <a href="${appUrl}/signin" ${BUTTON}>Continue with Google</a>
       <p ${SMALL}>If you didn't request this, you can safely ignore this email.</p>`,
    ),
  };
}
