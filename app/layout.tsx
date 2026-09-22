import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chair & Comb",
  description: "Salon bookings, client records and reminders for one stylist.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
