import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ex Lab",
  description:
    "전체 참가자를 최대 10명씩 나누어 진행하는 Ex Lab Race.",
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
