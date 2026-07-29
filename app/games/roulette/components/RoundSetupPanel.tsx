import { useId, useState } from 'react';

import {
  SetupChoiceControl,
  SetupOptionGroup,
  SetupOptionRow,
} from '../../../_platform/components/SetupWorkspace';
import type {
  DrawTarget,
  Participant,
  Prize,
  PrizeRecipientSource,
  WheelPresentation,
} from '../types';
import PrizeEditor from './PrizeEditor';
import './RoundSetupPanel.css';

type PrizePatch = Partial<Pick<Prize, 'name' | 'quantity'>>;
type PresentationChoice = WheelPresentation;

export interface RoundSetupPanelProps {
  target: DrawTarget;
  wheelPresentation: WheelPresentation;
  participantTotal: number;
  eligibleParticipants: Participant[];
  candidateParticipants: Participant[];
  drawOptionCount: number;
  winnerGoal: number;
  maximumWinnerGoal: number;
  excludedCount: number;
  poolLimit: number;
  prizes: Prize[];
  rewardLabel: string;
  drawLabel: string;
  prizeRecipientText: string;
  prizeRecipientCount: number;
  assignedPrizeRecipientCount: number;
  prizeRecipientSource: PrizeRecipientSource;
  recentWinnerCount: number;
  recentWinnersAlreadyLoaded: boolean;
  recentWinnerLabel?: string;
  removeAfterDraw: boolean;
  useWeights: boolean;
  disabled?: boolean;
  rosterManagedExternally?: boolean;
  /**
   * Standalone Roulette keeps its local disclosure for backwards
   * compatibility. The embedded setup delegates disclosure to SetupWorkspace.
   */
  includeAdvancedSettings?: boolean;
  onTargetChange: (target: DrawTarget) => void;
  onRewardLabelChange: (value: string) => void;
  onDrawLabelChange: (value: string) => void;
  onPrizeRecipientTextChange: (value: string) => void;
  onLoadRecentWinners: () => void;
  onRestartPrizeRecipients: () => void;
  onPoolLimitChange: (value: number) => void;
  onWinnerGoalChange: (value: number) => void;
  onReshufflePool: () => void;
  onPresentationChange: (choice: PresentationChoice) => void;
  onRemoveAfterDrawChange: (value: boolean) => void;
  onUseWeightsChange: (value: boolean) => void;
  onParticipantWeightChange: (id: string, weight: number) => void;
  onEditRoster?: () => void;
  onRestoreExcluded?: () => void;
  onAddPrize: () => void;
  onUpdatePrize: (id: string, patch: PrizePatch) => void;
  onPrizeWeightChange: (id: string, weight: number) => void;
  onRemovePrize: (id: string, name: string) => void;
}

function clampWholeNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

type RoundSetupAdvancedDescriptionProps = Pick<
  RoundSetupPanelProps,
  'target' | 'useWeights' | 'removeAfterDraw' | 'poolLimit' | 'rewardLabel'
>;

export function describeRoundSetupAdvancedSettings({
  target,
  useWeights,
  removeAfterDraw,
  poolLimit,
  rewardLabel,
}: RoundSetupAdvancedDescriptionProps) {
  const extraSettingCount = [
    poolLimit > 0,
    target === 'people' && Boolean(rewardLabel.trim()),
  ].filter(Boolean).length;

  const probabilityRule = target === 'people'
    ? useWeights ? '확률 지정' : '동일 확률'
    : '수량 비율';
  const duplicateRule = target === 'people'
    ? removeAfterDraw ? '당첨 후 제외' : '중복 허용'
    : '재고 차감';

  return `${probabilityRule} · ${duplicateRule}${
    extraSettingCount > 0 ? ` · 추가 ${extraSettingCount}` : ''
  }`;
}

export function RoundSetupAdvancedSettings({
  target,
  eligibleParticipants,
  candidateParticipants,
  poolLimit,
  rewardLabel,
  removeAfterDraw,
  useWeights,
  disabled = false,
  onRewardLabelChange,
  onPoolLimitChange,
  onReshufflePool,
  onRemoveAfterDrawChange,
  onUseWeightsChange,
  onParticipantWeightChange,
}: RoundSetupPanelProps) {
  const poolSampleSize = poolLimit > 0
    ? poolLimit
    : Math.min(10, eligibleParticipants.length);
  const effectivePoolLimit = Math.min(
    Math.max(1, poolLimit),
    Math.max(1, eligibleParticipants.length),
  );

  return (
    <div className="round-setup__advanced-body">
      {target === 'people' ? (
        <>
          <SetupOptionGroup
            kind="text"
            label="표시"
          >
            <SetupOptionRow label="상품명">
              <input
                className="round-setup__advanced-input"
                value={rewardLabel}
                maxLength={40}
                disabled={disabled}
                placeholder="예: 치킨 기프티콘"
                aria-label="상품명"
                onChange={(event) => onRewardLabelChange(event.target.value)}
              />
            </SetupOptionRow>
          </SetupOptionGroup>

          <SetupOptionGroup
            kind="choice"
            label="추첨 규칙"
          >
            <SetupOptionRow label="확률">
              <SetupChoiceControl
                variant="segmented"
                ariaLabel="확률"
                className="round-setup__segmented"
              >
                <button type="button" aria-pressed={!useWeights} disabled={disabled} onClick={() => onUseWeightsChange(false)}>동일 확률</button>
                <button type="button" aria-pressed={useWeights} disabled={disabled} onClick={() => onUseWeightsChange(true)}>직접 지정</button>
              </SetupChoiceControl>
            </SetupOptionRow>
            <SetupOptionRow label="중복 당첨">
              <SetupChoiceControl
                variant="segmented"
                ariaLabel="중복 당첨 규칙"
                className="round-setup__segmented"
              >
                <button type="button" aria-pressed={removeAfterDraw} disabled={disabled} onClick={() => onRemoveAfterDrawChange(true)}>당첨 후 제외</button>
                <button type="button" aria-pressed={!removeAfterDraw} disabled={disabled} onClick={() => onRemoveAfterDrawChange(false)}>중복 허용</button>
              </SetupChoiceControl>
            </SetupOptionRow>
            {eligibleParticipants.length > 0 && (
              <SetupOptionRow
                label="후보 범위"
                description={
                  poolLimit > 0
                    ? `${candidateParticipants.length}명 무작위 선택`
                    : '남은 명단 전체'
                }
              >
                <SetupChoiceControl
                  variant="segmented"
                  ariaLabel="후보 범위"
                  className="round-setup__segmented"
                >
                  <button type="button" aria-pressed={poolLimit === 0} disabled={disabled} onClick={() => onPoolLimitChange(0)}>전체</button>
                  <button type="button" aria-pressed={poolLimit > 0} disabled={disabled} onClick={() => onPoolLimitChange(Math.max(1, poolSampleSize))}>일부</button>
                </SetupChoiceControl>
              </SetupOptionRow>
            )}
          </SetupOptionGroup>

          {poolLimit > 0 && eligibleParticipants.length > 0 && (
            <SetupOptionGroup
              kind="number"
              label="후보 수"
              description="현재 명단에서 무작위로 뽑을 후보 수입니다."
            >
              <SetupOptionRow label="후보">
                <button
                  type="button"
                  className="round-setup__stepper-button"
                  aria-label="후보 수 줄이기"
                  disabled={disabled || effectivePoolLimit <= 1}
                  onClick={() =>
                    onPoolLimitChange(Math.max(1, effectivePoolLimit - 1))
                  }
                >
                  −
                </button>
                <span className="round-setup__stepper-value">
                  <input
                    type="number"
                    min="1"
                    max={eligibleParticipants.length}
                    value={effectivePoolLimit}
                    disabled={disabled}
                    aria-label="후보 수"
                    onChange={(event) =>
                      onPoolLimitChange(
                        clampWholeNumber(
                          Number(event.target.value),
                          1,
                          eligibleParticipants.length,
                        ),
                      )
                    }
                  />
                  <span aria-hidden="true">명</span>
                </span>
                <button
                  type="button"
                  className="round-setup__stepper-button"
                  aria-label="후보 수 늘리기"
                  disabled={
                    disabled
                    || effectivePoolLimit >= eligibleParticipants.length
                  }
                  onClick={() =>
                    onPoolLimitChange(
                      Math.min(
                        eligibleParticipants.length,
                        effectivePoolLimit + 1,
                      ),
                    )
                  }
                >
                  +
                </button>
              </SetupOptionRow>
              <button
                type="button"
                className="round-setup__support-button"
                disabled={disabled}
                onClick={onReshufflePool}
              >
                현재 후보 다시 섞기
              </button>
            </SetupOptionGroup>
          )}

          {useWeights && candidateParticipants.length > 0 && (
            <SetupOptionGroup
              kind="number"
              label="참여자별 추첨권"
              description="0장은 이번 추첨에서 제외됩니다."
              className="round-setup__weight-options"
            >
              {candidateParticipants.map((participant) => (
                <SetupOptionRow
                  key={participant.id}
                  label={participant.name}
                >
                  <button
                    type="button"
                    className="round-setup__stepper-button"
                    aria-label={`${participant.name} 추첨권 줄이기`}
                    disabled={disabled || participant.weight <= 0}
                    onClick={() =>
                      onParticipantWeightChange(
                        participant.id,
                        Math.max(0, participant.weight - 1),
                      )
                    }
                  >
                    −
                  </button>
                  <span className="round-setup__stepper-value">
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={participant.weight}
                      disabled={disabled}
                      aria-label={`${participant.name} 추첨권`}
                      onChange={(event) =>
                        onParticipantWeightChange(
                          participant.id,
                          clampWholeNumber(
                            Number(event.target.value),
                            0,
                            99,
                          ),
                        )
                      }
                    />
                    <span aria-hidden="true">장</span>
                  </span>
                  <button
                    type="button"
                    className="round-setup__stepper-button"
                    aria-label={`${participant.name} 추첨권 늘리기`}
                    disabled={disabled || participant.weight >= 99}
                    onClick={() =>
                      onParticipantWeightChange(
                        participant.id,
                        Math.min(99, participant.weight + 1),
                      )
                    }
                  >
                    +
                  </button>
                </SetupOptionRow>
              ))}
            </SetupOptionGroup>
          )}
        </>
      ) : (
        <div className="round-setup__fixed-rule-list">
          <span className="round-setup__fixed-rule">
            상품 종류마다 원판 한 구역
          </span>
          <span className="round-setup__fixed-rule">
            3개 : 2개 → 칸 넓이 3 : 2
          </span>
        </div>
      )}
    </div>
  );
}

export default function RoundSetupPanel(props: RoundSetupPanelProps) {
  const {
    target,
    wheelPresentation,
    participantTotal,
    drawOptionCount,
    winnerGoal,
    maximumWinnerGoal,
    excludedCount,
    prizes,
    drawLabel,
    prizeRecipientText,
    prizeRecipientCount,
    assignedPrizeRecipientCount,
    prizeRecipientSource,
    recentWinnerCount,
    recentWinnersAlreadyLoaded,
    recentWinnerLabel,
    useWeights,
    disabled = false,
    rosterManagedExternally = false,
    includeAdvancedSettings = true,
    onTargetChange,
    onDrawLabelChange,
    onPrizeRecipientTextChange,
    onLoadRecentWinners,
    onRestartPrizeRecipients,
    onWinnerGoalChange,
    onPresentationChange,
    onEditRoster,
    onRestoreExcluded,
    onAddPrize,
    onUpdatePrize,
    onPrizeWeightChange,
    onRemovePrize,
  } = props;
  const drawLabelInputId = useId();
  const winnerGoalInputId = useId();
  const maximumGoalForInput = Math.max(1, maximumWinnerGoal);
  const presentationChoice: PresentationChoice = wheelPresentation;
  const sourceValue = participantTotal === 0
    ? '명단 없음'
    : `${participantTotal}명${excludedCount > 0 ? ` · ${excludedCount}명 제외` : ''}`;
  const [advancedOpen, setAdvancedOpen] = useState(
    target === 'people' && (
      useWeights ||
      props.poolLimit > 0 ||
      Boolean(props.rewardLabel.trim())
    ),
  );
  const recipientStatus = prizeRecipientCount === 0
    ? '상품만 추첨'
    : `${prizeRecipientCount}명 · ${prizeRecipientSource === 'linked'
      ? `이전 당첨자 연동${recentWinnerLabel ? ` · ${recentWinnerLabel}` : ''}`
      : '직접 입력'}${assignedPrizeRecipientCount > 0
      ? ` · ${assignedPrizeRecipientCount}/${prizeRecipientCount} 배정 · 명단 잠김`
      : ''}`;
  const recentWinnerAction = recentWinnersAlreadyLoaded
    ? '연동됨'
    : recentWinnerCount === 0
      ? '없음'
      : prizeRecipientCount > 0 ? `${recentWinnerCount}명으로 교체` : `${recentWinnerCount}명 불러오기`;
  const externalPeopleRoster =
    rosterManagedExternally && target === 'people';
  const goalLabel = target === 'people' ? '당첨 인원' : '추첨 횟수';
  const goalUnit = target === 'people' ? '명' : '회';

  return (
    <section
      className="round-setup round-setup--compact"
      aria-label="추첨 설정"
      data-has-advanced={includeAdvancedSettings ? 'true' : 'false'}
      data-roster-managed-externally={
        externalPeopleRoster ? 'true' : 'false'
      }
    >
      <SetupOptionGroup
        kind="text"
        label="표시"
        description="방송 화면에 표시할 제목입니다."
      >
        <SetupOptionRow
          label="방송 제목"
          htmlFor={drawLabelInputId}
        >
          <input
            id={drawLabelInputId}
            value={drawLabel}
            maxLength={50}
            disabled={disabled}
            placeholder="예: 오늘의 선물 추첨"
            onChange={(event) => onDrawLabelChange(event.target.value)}
          />
        </SetupOptionRow>
      </SetupOptionGroup>

      <SetupOptionGroup
        kind="choice"
        label="추첨 방식"
      >
        <SetupOptionRow label="추첨 대상">
          <SetupChoiceControl
            variant="segmented"
            ariaLabel="추첨 대상"
            className="round-setup__segmented"
          >
            <button type="button" aria-pressed={target === 'people'} disabled={disabled} onClick={() => onTargetChange('people')}>
              <span aria-hidden="true">👤</span> 당첨자
            </button>
            <button type="button" aria-pressed={target === 'prizes'} disabled={disabled} onClick={() => onTargetChange('prizes')}>
              <span aria-hidden="true">🎁</span> 상품
            </button>
          </SetupChoiceControl>
        </SetupOptionRow>

        <SetupOptionRow label="연출">
          <SetupChoiceControl
            variant="segmented"
            ariaLabel="방송 연출"
            className="round-setup__segmented"
          >
            <button type="button" aria-pressed={presentationChoice === 'spin'} disabled={disabled} onClick={() => onPresentationChange('spin')}>
              <span aria-hidden="true">↻</span> 회전 룰렛
            </button>
            <button type="button" aria-pressed={presentationChoice === 'dart'} disabled={disabled} onClick={() => onPresentationChange('dart')}>
              <span aria-hidden="true">➶</span> 다트 복권
            </button>
          </SetupChoiceControl>
        </SetupOptionRow>
      </SetupOptionGroup>

      <SetupOptionGroup
        kind="number"
        label="결과 수량"
      >
        <SetupOptionRow
          label={goalLabel}
          htmlFor={winnerGoalInputId}
        >
          <button
            type="button"
            className="round-setup__stepper-button"
            aria-label={`${goalLabel} 하나 줄이기`}
            disabled={disabled || winnerGoal <= 1}
            onClick={() => onWinnerGoalChange(Math.max(1, winnerGoal - 1))}
          >
            −
          </button>
          <span className="round-setup__stepper-value">
            <input
              id={winnerGoalInputId}
              type="number"
              min="1"
              max={maximumGoalForInput}
              value={maximumWinnerGoal < 1 ? '' : Math.min(winnerGoal, maximumGoalForInput)}
              disabled={disabled || maximumWinnerGoal < 1}
              aria-describedby={`${winnerGoalInputId}-hint`}
              onChange={(event) => onWinnerGoalChange(clampWholeNumber(Number(event.target.value), 1, maximumGoalForInput))}
            />
            <span id={`${winnerGoalInputId}-hint`}>{goalUnit}</span>
          </span>
          <button
            type="button"
            className="round-setup__stepper-button"
            aria-label={`${goalLabel} 하나 늘리기`}
            disabled={disabled || maximumWinnerGoal < 1 || winnerGoal >= maximumGoalForInput}
            onClick={() => onWinnerGoalChange(Math.min(maximumGoalForInput, winnerGoal + 1))}
          >
            +
          </button>
        </SetupOptionRow>
      </SetupOptionGroup>

      {externalPeopleRoster && excludedCount > 0 && (
        <div className="round-setup__external-roster-status">
          <span className="round-setup__label">명단 상태</span>
          <div className="round-setup__external-roster-summary" role="status" aria-label="현재 룰렛 명단 상태">
            <strong>{drawOptionCount}명 추첨 가능</strong>
            <span>전체 {participantTotal}명{excludedCount > 0 ? ` · 당첨 제외 ${excludedCount}명` : ''}</span>
          </div>
          {excludedCount > 0 && onRestoreExcluded && (
            <button type="button" disabled={disabled} onClick={onRestoreExcluded}>
              {excludedCount}명 복귀
            </button>
          )}
        </div>
      )}

      <div
        className={`round-setup__data-slot round-setup__data-slot--${target}${
          externalPeopleRoster
            ? ' round-setup__data-slot--external-roster'
            : ''
        }`}
        data-setup-slot="data"
        data-setup-data-layout={target === 'people' ? 'span' : 'split'}
      >
        {target === 'people' && !rosterManagedExternally ? (
          <div className="round-setup__row round-setup__row--source round-setup__row--source-spanning">
            <span className="round-setup__label">명단</span>
            <div className="round-setup__source-summary">
              <strong>{sourceValue}</strong>
              {drawOptionCount > 0 && drawOptionCount !== participantTotal && (
                <span>추첨 가능 {drawOptionCount}명</span>
              )}
            </div>
            <div className="round-setup__source-actions">
              {excludedCount > 0 && onRestoreExcluded && (
                <button type="button" disabled={disabled} onClick={onRestoreExcluded}>{excludedCount}명 복귀</button>
              )}
              <button
                type="button"
                className={participantTotal === 0 ? 'is-primary' : undefined}
                disabled={disabled || onEditRoster === undefined}
                onClick={onEditRoster}
              >{participantTotal === 0 ? '명단 추가' : '편집'}</button>
            </div>
          </div>
        ) : target === 'prizes' ? (
          <div className="round-setup__row round-setup__row--source round-setup__row--recipients">
            <span className="round-setup__label">받을 사람</span>
            <label className="round-setup__recipient-entry">
              <textarea
                value={prizeRecipientText}
                rows={2}
                disabled={disabled || assignedPrizeRecipientCount > 0}
                aria-label="상품 받을 사람 명단"
                placeholder="직접 입력 · 한 줄에 한 명"
                onChange={(event) => onPrizeRecipientTextChange(event.target.value)}
              />
              <span>{recipientStatus}</span>
            </label>
            <div className="round-setup__source-actions round-setup__recipient-actions">
              <button
                type="button"
                disabled={disabled || assignedPrizeRecipientCount > 0 || recentWinnerCount === 0 || recentWinnersAlreadyLoaded}
                title={recentWinnerCount > 0 ? `${recentWinnerLabel ?? '최근 당첨자 추첨'} · ${recentWinnerCount}명` : undefined}
                onClick={onLoadRecentWinners}
              >
                <span>이전 당첨자</span>
                <strong>{recentWinnerAction}</strong>
              </button>
              {assignedPrizeRecipientCount > 0 && assignedPrizeRecipientCount < prizeRecipientCount && (
                <button type="button" disabled={disabled} onClick={onRestartPrizeRecipients}>같은 명단으로 새 배정</button>
              )}
            </div>
          </div>
        ) : null}

        {target === 'prizes' && (
          <div className="round-setup__prizes">
            <PrizeEditor
              prizes={prizes}
              useWeights={useWeights}
              showWeightFields={false}
              disabled={disabled}
              onAdd={onAddPrize}
              onUpdate={onUpdatePrize}
              onWeightChange={onPrizeWeightChange}
              onRemove={onRemovePrize}
            />
          </div>
        )}
      </div>

      {includeAdvancedSettings && (
        <details
          className="round-setup__advanced"
          data-setup-slot="advanced"
          open={advancedOpen}
          onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        >
          <summary>
            <span>세부 설정</span>
            <em>{describeRoundSetupAdvancedSettings(props)}</em>
          </summary>
          <RoundSetupAdvancedSettings {...props} />
        </details>
      )}
    </section>
  );
}
