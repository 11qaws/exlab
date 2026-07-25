import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Marble Showdown",
  description:
    "최대 10명이 참가하는 완전 물리 기반 마블 경기 추첨 시스템.",
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
