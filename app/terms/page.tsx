import Link from "next/link";

export const metadata = { title: "Terms of service · Length and Luxe" };

/** Public: Google's sign-in screen links here. */
export default function TermsPage() {
  return (
    <main className="narrow">
      <h1>Terms of service</h1>
      <p className="sub">Length and Luxe Hair Extensions · salon booking app</p>
      <div className="card">
        <p>
          This app is a private tool for running Length and Luxe Hair Extensions. Only the salon&apos;s
          own staff can sign in, and only to manage the salon&apos;s clients and appointments.
        </p>
        <p>
          Appointment times, prices and services shown in messages from the salon are set by the
          salon; prices may vary with hair length, thickness and texture. To change or cancel a
          booking, contact the salon.
        </p>
        <p>
          The app is provided as is. Questions: lengthandluxenyc@gmail.com.
        </p>
      </div>
      <p className="sub small"><Link href="/privacy">Privacy policy</Link></p>
    </main>
  );
}
