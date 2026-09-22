import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Maria Hair",
  description: "Hair style",
  applicationName: "Maria Hair",
  openGraph: {
    title: "Maria Hair",
    description: "Hair style",
    siteName: "Hair style",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Maria Hair",
    description: "Hair style",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
