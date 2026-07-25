import type { Metadata } from "next";
import { MarbleGame } from "./marble/MarbleGame";
import "./marble/marble-game.css";

export const metadata: Metadata = {
  title: "Marble Showdown — 기능 테스트",
  description:
    "최대 10명의 추첨 결과를 실제 물리 경기로 공개하는 단독 마블 게임 테스트.",
};

export default function Home() {
  return <MarbleGame />;
}
