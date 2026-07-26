import type { Metadata } from "next";
import { MarbleGame } from "./marble/MarbleGame";
import "./marble/marble-game.css";

export const metadata: Metadata = {
  title: "Ex Lab — Race",
  description:
    "전체 참가자를 최대 10명씩 나누어 진행하는 Ex Lab Race.",
};

export default function Home() {
  return <MarbleGame />;
}
