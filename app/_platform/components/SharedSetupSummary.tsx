"use client";

import {
  StreamerThemePicker,
  type StreamerThemeId,
} from "../theme";
import "./SharedSetupSummary.css";

export type SharedSetupSummaryProps = {
  rosterCount: number;
  allowDuplicateNames: boolean;
  streamerThemeId: StreamerThemeId;
  onStreamerThemeChange: (themeId: StreamerThemeId) => void;
  onRequestRosterEdit: () => void;
  disabled?: boolean;
};

/**
 * The single shared setup boundary used by every embedded exlab game.
 * Participant colours and game-semantic colours intentionally remain outside
 * this component; the selected streamer identity only paints product chrome.
 */
export function SharedSetupSummary({
  rosterCount,
  allowDuplicateNames,
  streamerThemeId,
  onStreamerThemeChange,
  onRequestRosterEdit,
  disabled = false,
}: SharedSetupSummaryProps) {
  return (
    <div className="exlab-shared-setup">
      <div className="exlab-shared-roster">
        <div>
          <span>참가자 명단</span>
          <strong>{rosterCount}명</strong>
          <small>
            동일 이름 {allowDuplicateNames ? "허용" : "미허용"}
          </small>
        </div>
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="dialog"
          onClick={onRequestRosterEdit}
        >
          명단 편집
        </button>
      </div>

      <StreamerThemePicker
        className="exlab-shared-theme-picker"
        value={streamerThemeId}
        onChange={onStreamerThemeChange}
        disabled={disabled}
        legend="스트리머 테마"
        description="프로필을 선택하면 두 게임의 공통 화면에 바로 적용됩니다."
      />
    </div>
  );
}
