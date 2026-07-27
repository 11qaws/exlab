"use client";

import "./SharedSetupSummary.css";

export type SharedSetupSummaryProps = {
  rosterCount: number;
  allowDuplicateNames: boolean;
  onRequestRosterEdit: () => void;
  disabled?: boolean;
};

/**
 * The shared roster boundary used by every embedded exlab game.
 * The product shell owns the global streamer theme control.
 */
export function SharedSetupSummary({
  rosterCount,
  allowDuplicateNames,
  onRequestRosterEdit,
  disabled = false,
}: SharedSetupSummaryProps) {
  return (
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
  );
}
