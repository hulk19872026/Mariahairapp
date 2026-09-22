import Link from "next/link";
import { logoutAction } from "./login/actions";

export function Nav({ username }: { username: string }) {
  return (
    <nav className="nav">
      <Link href="/">Home</Link>
      <Link href="/setup">Setup</Link>
      <span className="spacer" />
      <span className="sub small">{username}</span>
      <form action={logoutAction}>
        <button type="submit" className="ghost">Sign out</button>
      </form>
    </nav>
  );
}
