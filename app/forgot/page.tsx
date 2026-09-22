import Link from "next/link";
import { forgotAction } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  empty: "Enter your username or email.",
  noemail:
    "There's no email address on that account, so a password can't be sent. Another user can set one for you in Setup.",
  mail: "Email isn't set up on this server yet (RESEND_API_KEY and MAIL_FROM), so nothing could be sent.",
};

type Props = { searchParams: Promise<{ error?: string; sent?: string }> };

export default async function ForgotPage({ searchParams }: Props) {
  const sp = await searchParams;
  return (
    <main className="narrow">
      <h1>Forgot password</h1>
      <p className="sub">We&apos;ll email a new password to the address on your account.</p>

      {sp.error && <p className="notice bad">{ERRORS[sp.error] ?? "Something went wrong."}</p>}
      {sp.sent && (
        <p className="notice good">If that account exists, a new password is on its way.</p>
      )}

      <form action={forgotAction} className="card form">
        <label>
          Username or email
          <input name="who" autoComplete="username" required autoFocus />
        </label>
        <button type="submit">Email me a new password</button>
        <p className="sub small">
          <Link href="/login">Back to sign in</Link>
        </p>
      </form>
    </main>
  );
}
