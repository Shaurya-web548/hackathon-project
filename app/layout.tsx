import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crucible — CI for AI Agents",
  description:
    "Adversarial test harness for AI agents: sandboxed runs, failure taxonomy, reliability scorecard.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
