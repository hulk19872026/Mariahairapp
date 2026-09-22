import { prisma } from "@/lib/prisma";
import { fmtDate, fmtTime, getSettings, localDate, serviceNames } from "@/lib/automation";
import { integrationStatus } from "@/lib/senders";
import { storageName } from "@/lib/storage";

// Everything here reads the database, so never pre-render it at build time.
export const dynamic = "force-dynamic";

export default async function Home() {
  const st = await getSettings();
  const tz = st.timezone || "America/New_York";
  const today = localDate(new Date(), tz);

  const [services, appointments, customers, lastRun] = await Promise.all([
    prisma.service.findMany(),
    prisma.appointment.findMany({
      where: { date: today, status: { in: ["scheduled", "confirmed"] } },
      include: { customer: true },
      orderBy: { start: "asc" },
    }),
    prisma.customer.count(),
    prisma.cronRun.findFirst({ orderBy: { startedAt: "desc" } }),
  ]);

  const integ = integrationStatus();

  return (
    <main>
      <h1>{st.bizName || "Chair & Comb"}</h1>
      <p className="sub">{fmtDate(today, "full")}</p>

      <div className="grid">
        <div className="card">
          <div className="label">Clients</div>
          <div className="value">{customers}</div>
        </div>
        <div className="card">
          <div className="label">Today&apos;s appointments</div>
          <div className="value">{appointments.length}</div>
        </div>
        <div className="card">
          <div className="label">Email</div>
          <div className={`value ${integ.email ? "ok" : "warn"}`}>
            {integ.email ? "Connected" : "Not set up"}
          </div>
        </div>
        <div className="card">
          <div className="label">Text messages</div>
          <div className={`value ${integ.sms ? "ok" : "warn"}`}>
            {integ.sms ? "Connected" : "Not set up"}
          </div>
        </div>
        <div className="card">
          <div className="label">Photo storage</div>
          <div className="value">{storageName()}</div>
        </div>
        <div className="card">
          <div className="label">Last reminder run</div>
          <div className="value">
            {lastRun
              ? `${lastRun.sent} sent`
              : "Never"}
          </div>
          {lastRun && (
            <div className="label">
              {lastRun.startedAt.toLocaleString("en-US", { timeZone: tz })}
              {integ.dryRun ? " · dry run" : ""}
            </div>
          )}
        </div>
      </div>

      <h2>Today</h2>
      {appointments.length === 0 ? (
        <div className="empty">Nothing booked for today.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Client</th>
              <th>Service</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {appointments.map((a) => (
              <tr key={a.id}>
                <td>{fmtTime(a.start)}</td>
                <td>{`${a.customer.first} ${a.customer.last}`.trim() || "—"}</td>
                <td>{serviceNames(a, services)}</td>
                <td>{a.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Reminders</h2>
      <p className="sub">
        Reminders go out when the scheduler calls <code>POST /api/cron</code> with the{" "}
        <code>CRON_SECRET</code> bearer token, or when <code>npm run cron</code> is run
        from a Railway cron service.
      </p>
    </main>
  );
}
