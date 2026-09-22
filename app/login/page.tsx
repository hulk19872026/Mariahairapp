import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loginAction } from "./actions";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ error?: string; next?: string; reset?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  if (await getSession()) redirect("/");
  const sp = await searchParams;

  return (
    <main className="narrow">
      <h1>Sign in</h1>
      <p className="sub">Maria Hair</p>

      {sp.error && <p className="notice bad">That username or password isn&apos;t right.</p>}
      {sp.reset && (
        <p className="notice good">
          Your new password was emailed. Sign in with it, then change it in Setup.
        </p>
      )}

      <form action={loginAction} className="card form">
        {sp.next && <input type="hidden" name="next" value={sp.next} />}
        <label>
          Username
          <input name="username" autoComplete="username" required autoFocus />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit">Sign in</button>
        <p className="sub small">
          <Link href="/forgot">Forgot your password?</Link>
        </p>
      </form>
    </main>
  );
}
