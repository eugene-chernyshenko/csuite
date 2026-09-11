import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      className={`${plexSans.variable} ${sourceSerif.variable} ${plexMono.variable}`}
    >
      <body className="flex h-dvh flex-col overflow-hidden">
        <NextIntlClientProvider>
          <SimProvider>
            <TopBar />
            <TransportBar />
            <main className="min-h-0 flex-1 overflow-auto">{children}</main>
          </SimProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
