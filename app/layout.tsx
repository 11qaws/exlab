import type { Metadata } from "next";
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
    images: [
      {
        url: "/og.png",
        width: 1731,
        height: 909,
        alt: "exlab Roulette와 Showdown",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "exlab",
    description: "Roulette와 Showdown을 한 명단으로 운영하는 게임 도구.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
