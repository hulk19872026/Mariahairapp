import Link from "next/link";

export const metadata = { title: "Privacy policy · Length and Luxe" };

/** Public: Google's sign-in screen links here. */
export default function PrivacyPage() {
  return (
    <main className="narrow">
      <h1>Privacy policy</h1>
      <p className="sub">Length and Luxe Hair Extensions · salon booking app</p>
      <div className="card">
        <p>
          This app is used only by the salon to manage its own clients and appointments. It is not
          offered to the public, and there are no accounts for anyone outside the salon.
        </p>
        <h2>What it keeps</h2>
        <p>
          Client names and contact details, appointment times and services, notes, photos taken at
          the chair, and the messages the salon sends. All of it is stored in the salon&apos;s own
          database and is never sold or shared with anyone else.
        </p>
        <h2>Google Calendar</h2>
        <p>
          When the salon connects its Google Calendar, the app reads and writes events in the one
          calendar the salon picks, to keep appointments the same in both places. It does not use
          calendar data for anything else, does not share it, and stops as soon as the calendar is
          disconnected in Settings or access is removed at myaccount.google.com/permissions.
          The app&apos;s use of information received from Google APIs adheres to the Google API
          Services User Data Policy, including the Limited Use requirements.
        </p>
        <h2>Messages</h2>
        <p>
          Appointment emails and texts are sent through Resend and Twilio, only to clients of the
          salon. Clients can unsubscribe from email at any time, or reply STOP to texts.
        </p>
        <h2>Questions</h2>
        <p>Email lengthandluxenyc@gmail.com.</p>
      </div>
      <p className="sub small"><Link href="/terms">Terms of service</Link></p>
    </main>
  );
}
