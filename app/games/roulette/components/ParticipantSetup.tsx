import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';

import {
  MAX_SHARED_NAME_LENGTH,
  MAX_SHARED_ROSTER_SIZE,
  sharedRosterNameKey,
  sharedRosterNameLength,
} from '../../../_platform/roster';
import { STREAMER_THEMES } from '../../../_platform/theme';
import { extractNaverCafeCommentAuthors } from '../../../_platform/cafeCommentParser';
import type { Participant } from '../types';

import './ParticipantSetup.css';

type SetupStep = 'review' | 'edit';

type ParseSummary = {
  total: number;
  replies: number;
};

type DraftValidation = {
  error: string | null;
  invalidParticipantIds: Set<string>;
};

const STREAMER_NAME_PLACEHOLDER = STREAMER_THEMES
  .map(({ name }) => name)
  .join('\n');

export interface ParticipantSetupProps {
  initialParticipants: Participant[];
  initialStep?: SetupStep;
  onCancel?: () => void;
  /** Clears the saved roster after the parent has confirmed the destructive action. */
  onClear?: () => void;
  /** Mirrors the unsaved draft into the non-committing stage preview. */
  onDraftChange?: (participants: Participant[]) => void;
  onDirtyChange?: (dirty: boolean) => void;
  allowDuplicateNames?: boolean;
  onStart: (participants: Participant[]) => void;
}

function makeId(index: number) {
  return `participant-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizedName(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizedParticipants(items: readonly Participant[]) {
  return items.map((item) => ({
    ...item,
    name: normalizedName(item.name),
  }));
}

function previewParticipants(items: readonly Participant[]) {
  return normalizedParticipants(items).filter((item) => item.name.length > 0);
}

function validateParticipantDraft(
  items: readonly Participant[],
  allowDuplicateNames: boolean,
): DraftValidation {
  const invalidParticipantIds = new Set<string>();
  const normalized = items.map((item, index) => ({
    id: item.id,
    index,
    name: normalizedName(item.name),
  }));

  if (normalized.length === 0) {
    return {
      error: '추첨을 시작하려면 참여자가 한 명 이상 필요해요.',
      invalidParticipantIds,
    };
  }

  const blank = normalized.find((item) => item.name.length === 0);
  if (blank) {
    invalidParticipantIds.add(blank.id);
    return {
      error: `${blank.index + 1}번 참여자 이름을 입력하거나 해당 행을 삭제해 주세요.`,
      invalidParticipantIds,
    };
  }

  if (normalized.length > MAX_SHARED_ROSTER_SIZE) {
    return {
      error: `참가자는 최대 ${MAX_SHARED_ROSTER_SIZE}명까지 저장할 수 있어요. 현재 ${normalized.length}명입니다.`,
      invalidParticipantIds,
    };
  }

  const tooLong = normalized.filter(
    (item) => sharedRosterNameLength(item.name) > MAX_SHARED_NAME_LENGTH,
  );
  if (tooLong.length > 0) {
    tooLong.forEach((item) => invalidParticipantIds.add(item.id));
    const details = tooLong
      .map((item) => `${item.index + 1}번 ${sharedRosterNameLength(item.name)}자`)
      .join(', ');
    return {
      error: `이름은 ${MAX_SHARED_NAME_LENGTH}자 이내로 입력해 주세요: ${details}`,
      invalidParticipantIds,
    };
  }

  if (!allowDuplicateNames) {
    const namesByKey = new Map<string, typeof normalized>();
    normalized.forEach((item) => {
      const key = sharedRosterNameKey(item.name);
      namesByKey.set(key, [...(namesByKey.get(key) ?? []), item]);
    });
    const duplicates = [...namesByKey.values()].filter((matches) => matches.length > 1);
    if (duplicates.length > 0) {
      duplicates.flat().forEach((item) => invalidParticipantIds.add(item.id));
      const details = duplicates
        .map((matches) => `${matches[0].name} (${matches.length}명)`)
        .join(', ');
      return {
        error: `동일 이름을 정리하거나 허용 옵션을 켜 주세요: ${details}`,
        invalidParticipantIds,
      };
    }
  }

  return { error: null, invalidParticipantIds };
}

function parseManualNames(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((name) => name.replace(/^[-•·]\s*/, '').trim())
    .filter((name) => name.length > 0)
    .filter((name) => !/^(?:답글쓰기|더보기|등록|댓글|프로필 사진)$/u.test(name));
}

function rosterFingerprint(items: readonly Participant[]) {
  return JSON.stringify(items.map((item) => ({
    id: item.id,
    name: item.name,
    weight: item.weight,
  })));
}

export default function ParticipantSetup({
  initialParticipants,
  initialStep = 'edit',
  onCancel,
  onClear,
  onDraftChange,
  onDirtyChange,
  allowDuplicateNames = false,
  onStart,
}: ParticipantSetupProps) {
  const [step, setStep] = useState<SetupStep>(initialStep);
  const [cafeImportOpen, setCafeImportOpen] = useState(false);
  const [pastedPage, setPastedPage] = useState('');
  const [draft, setDraft] = useState<Participant[]>(() => (
    initialParticipants.map((participant) => ({ ...participant }))
  ));
  const [manualNames, setManualNames] = useState('');
  const [parseError, setParseError] = useState('');
  const [manualError, setManualError] = useState('');
  const [editorNotice, setEditorNotice] = useState('');
  const [summary, setSummary] = useState<ParseSummary | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const richClipboard = useRef('');
  const initialFingerprint = useRef(
    rosterFingerprint(initialParticipants),
  );
  const draftValidation = useMemo(
    () => validateParticipantDraft(draft, allowDuplicateNames),
    [allowDuplicateNames, draft],
  );

  useEffect(() => {
    onDraftChange?.(previewParticipants(draft));
  }, [draft, onDraftChange]);

  useEffect(() => {
    onDirtyChange?.(
      rosterFingerprint(draft) !== initialFingerprint.current
      || pastedPage.trim().length > 0
      || manualNames.trim().length > 0,
    );
  }, [draft, manualNames, onDirtyChange, pastedPage]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>('[data-setup-initial-focus]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  useEffect(() => {
    if (!cafeImportOpen) return undefined;
    const frame = window.requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>('[data-setup-initial-focus]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cafeImportOpen]);

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!onCancel) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [...(rootRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) ?? [])].filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain') || event.clipboardData.getData('text');
    richClipboard.current = event.clipboardData.getData('text/html');
    setPastedPage(text);
    setParseError('');
  };

  const handleParse = () => {
    const source = richClipboard.current || pastedPage;
    if (!source.trim()) {
      setParseError('카페 페이지에서 복사한 내용을 먼저 붙여넣어 주세요.');
      return;
    }

    const candidates = extractNaverCafeCommentAuthors(source);
    const roots = candidates.filter((candidate) => !candidate.reply);
    if (roots.length === 0) {
      setParseError('댓글 작성자를 찾지 못했어요. 원문은 그대로 두었어요. 직접 명단을 만들 수도 있어요.');
      return;
    }

    const nextDraft = roots.map((candidate, index) => ({
      id: `${candidate.id || makeId(index)}-${index}`,
      name: candidate.nick,
      weight: 1,
      commentCount: 1,
    }));
    setDraft(nextDraft);
    setSummary({ total: nextDraft.length, replies: candidates.filter((candidate) => candidate.reply).length });
    setParseError('');
    setManualError('');
    setStep('review');
  };

  const returnToEditor = (openCafeImport = false) => {
    setCafeImportOpen(openCafeImport);
    setStep('edit');
  };

  const addManualNames = () => {
    const names = parseManualNames(manualNames);
    if (names.length === 0) {
      setManualError('추가할 이름을 한 줄에 한 명씩 입력해 주세요.');
      setEditorNotice('');
      return;
    }

    const nextDraft = [
      ...draft,
      ...names.map((name, index) => ({
        id: makeId(index),
        name,
        weight: 1,
        commentCount: 1,
      })),
    ];
    setDraft(nextDraft);
    setManualNames('');
    setManualError('');
    setEditorNotice(`${names.length}명을 명단에 추가했어요.`);
  };

  const updateName = (id: string, name: string) => {
    setDraft((items) => items.map((item) => (item.id === id ? { ...item, name } : item)));
    setManualError('');
    setEditorNotice('');
  };

  const removeParticipant = (id: string) => {
    setDraft((items) => items.filter((item) => item.id !== id));
    setManualError('');
    setEditorNotice('');
  };

  const moveParticipant = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draft.length) return;
    setDraft((items) => {
      const next = [...items];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const finishSetup = () => {
    if (draftValidation.error) return;
    onStart(normalizedParticipants(draft));
  };

  return (
    <section ref={rootRef} className="participant-setup" aria-labelledby="participant-setup-title" onKeyDown={handleDialogKeyDown}>
      <header className="participant-setup__header">
        <div>
          <h1 id="participant-setup-title">
            {step === 'review' && '명단 확인'}
            {step === 'edit' && (initialParticipants.length > 0 ? '명단 편집' : '명단 작성')}
          </h1>
          <p>{step === 'review' ? `${summary?.total ?? draft.length}명` : `${draft.length}명 저장 전`}</p>
        </div>
        {(onClear || onCancel) && (
          <div className="setup-header-actions">
            {onClear && <button className="setup-clear" type="button" onClick={onClear}>명단 비우기</button>}
            {onCancel && (
              <button className="setup-close" type="button" onClick={onCancel} aria-label="명단 편집 닫기">
                ×
              </button>
            )}
          </div>
        )}
      </header>

      {step === 'review' && (
        <div className="setup-pane">
          <div className="setup-summary">
            <strong>{summary?.total ?? draft.length}명</strong>
            <span>{summary && summary.replies > 0 ? `대댓글 ${summary.replies}개 제외` : '댓글 작성자'}</span>
          </div>
          {draftValidation.error && (
            <p id="participant-setup-validation" className="setup-message setup-message--error" role="alert">
              {draftValidation.error}
            </p>
          )}
          <ol className="setup-review-list">
            {draft.slice(0, 80).map((participant) => <li key={participant.id}>{participant.name}</li>)}
          </ol>
          {draft.length > 80 && <p className="setup-list-note">처음 80명 표시 · 전체 {draft.length}명</p>}
          <div className="setup-actions">
            <button
              data-setup-initial-focus={!draftValidation.error ? true : undefined}
              className="setup-primary"
              type="button"
              onClick={finishSetup}
              disabled={Boolean(draftValidation.error)}
            >
              이 명단 사용
            </button>
            <button
              data-setup-initial-focus={draftValidation.error ? true : undefined}
              className="setup-secondary"
              type="button"
              onClick={() => returnToEditor()}
            >
              명단 수정
            </button>
            <button className="setup-link-button" type="button" onClick={() => returnToEditor(true)}>다시 가져오기</button>
          </div>
        </div>
      )}

      {step === 'edit' && (
        <div className="setup-pane">
          <details
            className="setup-import-option"
            open={cafeImportOpen}
            onToggle={(event) => setCafeImportOpen(event.currentTarget.open)}
          >
            <summary>카페 댓글에서 가져오기</summary>
            <div className="setup-import-option__body">
              <p className="setup-copy">카페 글에서 <strong>Ctrl+A → Ctrl+C</strong> 후 아래에 붙여넣으세요.</p>
              <textarea
                data-setup-initial-focus={cafeImportOpen ? true : undefined}
                className="setup-textarea setup-textarea--import"
                value={pastedPage}
                onChange={(event) => {
                  richClipboard.current = '';
                  setPastedPage(event.target.value);
                  setParseError('');
                }}
                onPaste={handlePaste}
                placeholder="카페 글 전체 붙여넣기"
                aria-label="카페 페이지 내용"
                aria-invalid={Boolean(parseError) || undefined}
                aria-describedby={parseError ? 'participant-setup-cafe-error' : undefined}
              />
              {parseError && (
                <p id="participant-setup-cafe-error" className="setup-message setup-message--error" role="alert">
                  {parseError}
                </p>
              )}
              <div className="setup-inline-action">
                <button className="setup-secondary" type="button" onClick={handleParse}>댓글 작성자 가져오기</button>
              </div>
              <p className="setup-privacy">붙여넣은 내용은 브라우저 안에서만 처리됩니다.</p>
            </div>
          </details>
          <label className="setup-field-label" htmlFor="manual-names">
            <span>한 줄에 한 명</span>
            <span className="setup-field-shortcut">Shift+Enter로 한 번에 추가</span>
          </label>
          <textarea
            data-setup-initial-focus={!cafeImportOpen ? true : undefined}
            id="manual-names"
            className="setup-textarea setup-textarea--short"
            value={manualNames}
            onChange={(event) => {
              setManualNames(event.target.value);
              setManualError('');
              setEditorNotice('');
            }}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                event.shiftKey &&
                !event.repeat &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                addManualNames();
              }
            }}
            aria-keyshortcuts="Shift+Enter"
            aria-invalid={Boolean(manualError) || undefined}
            aria-describedby={manualError ? 'participant-setup-manual-error' : undefined}
            placeholder={STREAMER_NAME_PLACEHOLDER}
          />
          <div className="setup-inline-action">
            <button className="setup-secondary" type="button" onClick={addManualNames}>명단에 추가</button>
          </div>
          {manualError && (
            <p id="participant-setup-manual-error" className="setup-message setup-message--error" role="alert">
              {manualError}
            </p>
          )}

          <div className="setup-editor-heading">
            <div>
              <strong>참여자 {draft.length}명</strong>
            </div>
          </div>
          {draftValidation.error && (
            <p id="participant-setup-validation" className="setup-message setup-message--error" role="alert">
              {draftValidation.error}
            </p>
          )}
          <ol className="setup-editor-list">
            {draft.map((participant, index) => (
              <li key={participant.id}>
                <span className="setup-order">{index + 1}</span>
                <input
                  value={participant.name}
                  onChange={(event) => updateName(participant.id, event.target.value)}
                  aria-label={`${index + 1}번 참여자 이름`}
                  aria-invalid={draftValidation.invalidParticipantIds.has(participant.id) || undefined}
                  aria-describedby={
                    draftValidation.invalidParticipantIds.has(participant.id)
                      ? 'participant-setup-validation'
                      : undefined
                  }
                />
                <div className="setup-row-actions">
                  <button type="button" onClick={() => moveParticipant(index, -1)} disabled={index === 0} aria-label={`${participant.name} 위로`}>↑</button>
                  <button type="button" onClick={() => moveParticipant(index, 1)} disabled={index === draft.length - 1} aria-label={`${participant.name} 아래로`}>↓</button>
                  <button type="button" onClick={() => removeParticipant(participant.id)} aria-label={`${participant.name} 삭제`}>×</button>
                </div>
              </li>
            ))}
          </ol>
          {editorNotice && <p className="setup-message" role="status">{editorNotice}</p>}
          <div className="setup-actions setup-actions--finish">
            <button
              className="setup-primary"
              type="button"
              onClick={finishSetup}
              disabled={Boolean(draftValidation.error)}
            >
              명단 저장
            </button>
            {onCancel && <button className="setup-secondary" type="button" onClick={onCancel}>취소</button>}
          </div>
        </div>
      )}
    </section>
  );
}
