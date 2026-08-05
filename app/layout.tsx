import type { Metadata } from "next";
import { preload } from "react-dom";
import { STREAMER_THEME_PORTRAIT_ASSETS } from "./_platform/theme/streamerThemes";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://marble-showdown-lab.civtale.chatgpt.site"),
  applicationName: "exlab",
  title: {
    default: "exlab",
    template: "%s · exlab",
  },
  description: "Roulette와 Showdown을 한 명단으로 운영하는 게임 도구.",
  openGraph: {
    type: "website",
    siteName: "exlab",
    title: "exlab",
    description: "Roulette와 Showdown을 한 명단으로 운영하는 게임 도구.",
  },
  twitter: {
    card: "summary",
    title: "exlab",
    description: "Roulette와 Showdown을 한 명단으로 운영하는 게임 도구.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  for (const asset of Object.values(STREAMER_THEME_PORTRAIT_ASSETS)) {
    preload(`/${asset.path}`, {
      as: "image",
      fetchPriority: "high",
      type: asset.mimeType,
    });
  }

  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
