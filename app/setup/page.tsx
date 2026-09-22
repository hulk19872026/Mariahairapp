import { prisma } from "@/lib/prisma";
import { MIN_PASSWORD, requireUser } from "@/lib/auth";
import { mailConfigured } from "@/lib/mail";
import { Nav } from "../nav";
import {
  addUserAction,
  changePasswordAction,
  removeUserAction,
  resetUserPasswordAction,
  updateEmailAction,
} from "./actions";

export const dynamic = "force-dynamic";

const OK: Record<string, string> = {
  password: "Your password has been changed.",
  email: "Your email address has been saved.",
  added: "The new user can sign in now.",
  removed: "That user has been removed.",
  reset: "That user's password has been set.",
};

const ERRORS: Record<string, string> = {
  current: "Your current password wasn't right.",
  short: `Passwords need at least ${MIN_PASSWORD} characters.`,
  match: "The two new passwords didn't match.",
  email: "That doesn't look like an email address.",
  username: "Usernames are 2–32 letters, numbers, dots, dashes or underscores.",
  exists: "There's already a user with that name.",
  self: "You can't remove or reset your own account here. Use the password form above.",
};

type Props = { searchParams: Promise<{ ok?: string; error?: string }> };

export default async function SetupPage({ searchParams }: Props) {
  const me = await requireUser();
  const sp = await searchParams;
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  const mail = mailConfigured();

  return (
    <main>
      <Nav username={me.username} />
      <h1>Setup</h1>
      <p className="sub">Your account and who else can sign in.</p>

      {sp.ok && <p className="notice good">{OK[sp.ok] ?? "Saved."}</p>}
      {sp.error && <p className="notice bad">{ERRORS[sp.error] ?? "Something went wrong."}</p>}

      <h2>Your email</h2>
      <p className="sub small">
        Where &ldquo;forgot password&rdquo; sends a new password.
        {!mail && " Email isn't set up on this server yet, so resets can't be sent until it is."}
      </p>
      <form action={updateEmailAction} className="card form">
        <label>
          Email address
          <input name="email" type="email" defaultValue={me.email} placeholder="you@example.com" />
        </label>
        <button type="submit">Save email</button>
      </form>

      <h2>Change your password</h2>
      <form action={changePasswordAction} className="card form">
        <label>
          Current password
          <input name="current" type="password" autoComplete="current-password" required />
        </label>
        <label>
          New password
          <input name="next" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required />
        </label>
        <label>
          New password again
          <input name="confirm" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required />
        </label>
        <button type="submit">Change password</button>
      </form>

      <h2>Users</h2>
      <table>
        <thead>
          <tr>
            <th>Username</th>
            <th>Email</th>
            <th>Added</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>
                {u.username}
                {u.id === me.id && <span className="tag">you</span>}
              </td>
              <td>{u.email || "—"}</td>
              <td>{u.createdAt.toLocaleDateString("en-US")}</td>
              <td className="actions">
                {u.id !== me.id && (
                  <>
                    <form action={resetUserPasswordAction} className="inline">
                      <input type="hidden" name="id" value={u.id} />
                      <input
                        name="password"
                        type="password"
                        placeholder="New password"
                        minLength={MIN_PASSWORD}
                        required
                      />
                      <button type="submit" className="ghost">Set</button>
                    </form>
                    <form action={removeUserAction} className="inline">
                      <input type="hidden" name="id" value={u.id} />
                      <button type="submit" className="ghost danger">Remove</button>
                    </form>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Add a user</h2>
      <form action={addUserAction} className="card form">
        <label>
          Username
          <input name="username" autoComplete="off" required />
        </label>
        <label>
          Email (optional, used for password resets)
          <input name="email" type="email" autoComplete="off" />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required />
        </label>
        <button type="submit">Add user</button>
      </form>
    </main>
  );
}
