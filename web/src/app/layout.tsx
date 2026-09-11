import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { SimProvider } from "@/lib/sim";
import { TopBar } from "@/components/chrome/TopBar";
import { TransportBar } from "@/components/chrome/TransportBar";

const plexSans = IBM_Plex_Sans({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-plex-sans",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "csuite — your AI C-suite",
  description:
    "A company of agents with a human CEO: board deliberation, approval gates, departments, reports.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${plexSans.variable} ${sourceSerif.variable} ${plexMono.variable} flex h-dvh flex-col overflow-hidden`}
      >
        <SimProvider>
          <TopBar />
          <TransportBar />
          <main className="min-h-0 flex-1 overflow-auto">{children}</main>
        </SimProvider>
      </body>
    </html>
  );
}
