import {
  useId,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";

import {
  SetupPrimaryActionButton,
  SetupReadinessStatus,
  type SetupPrimaryActionModel,
  type SetupReadinessModel,
} from "./SetupControls";
import "./SetupWorkspace.css";

export {
  SETUP_OPTION_GROUP_KINDS,
  SETUP_CHOICE_CONTROL_VARIANTS,
  SETUP_READINESS_TONES,
  SetupChoiceControl,
  SetupOptionGroup,
  SetupOptionRow,
  SetupPrimaryActionButton,
  SetupReadinessStatus,
  type SetupOptionGroupKind,
  type SetupChoiceControlProps,
  type SetupChoiceControlVariant,
  type SetupOptionGroupProps,
  type SetupOptionRowProps,
  type SetupPrimaryActionButtonProps,
  type SetupPrimaryActionModel,
  type SetupReadinessModel,
  type SetupReadinessStatusProps,
  type SetupReadinessTone,
} from "./SetupControls";

type ControlledAdvancedSettings = {
  advancedSettingsOpen: boolean;
  defaultAdvancedSettingsOpen?: never;
  onAdvancedSettingsOpenChange: (open: boolean) => void;
};

type UncontrolledAdvancedSettings = {
  advancedSettingsOpen?: undefined;
  defaultAdvancedSettingsOpen?: boolean;
  onAdvancedSettingsOpenChange?: (open: boolean) => void;
};

type SetupWorkspaceBaseProps = {
  /**
   * Optional root class for game-specific layout adjustments. The common
   * workspace classes remain responsible for its information hierarchy.
   */
  className?: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  sharedSetup: ReactNode;
  sharedSetupLabel?: ReactNode;
  essentialSettings: ReactNode;
  essentialSettingsLabel?: ReactNode;
  advancedSettings?: ReactNode;
  advancedSettingsLabel?: ReactNode;
  advancedSettingsDescription?: ReactNode;
  previewHeader: ReactNode;
  previewLabel?: string;
  previewTools?: ReactNode;
  previewStage: ReactNode;
  previewFooter?: ReactNode;
  readinessLabel?: string;
  secondaryActions?: ReactNode;
  busy?: boolean;
};

type LegacyReadinessContent = {
  readiness: ReactNode;
  readinessModel?: never;
};

type StructuredReadinessContent = {
  readiness?: never;
  readinessModel: SetupReadinessModel;
};

type LegacyPrimaryActionContent = {
  primaryAction: ReactNode;
  primaryActionModel?: never;
};

type StructuredPrimaryActionContent = {
  primaryAction?: never;
  primaryActionModel: SetupPrimaryActionModel;
};

export type SetupWorkspaceProps = SetupWorkspaceBaseProps
  & (ControlledAdvancedSettings | UncontrolledAdvancedSettings)
  & (LegacyReadinessContent | StructuredReadinessContent)
  & (LegacyPrimaryActionContent | StructuredPrimaryActionContent);

/**
 * Shared exlab setup frame.
 *
 * The host owns shared roster state and exposes the global theme in the shell
 * header, while each game supplies its own settings, preview and start action
 * through the slots below. This component intentionally provides layout and
 * semantics only; it never copies or owns game state.
 */
export function SetupWorkspace({
  className,
  eyebrow,
  title,
  description,
  sharedSetup,
  sharedSetupLabel = "공통 설정",
  essentialSettings,
  essentialSettingsLabel = "게임 설정",
  advancedSettings,
  advancedSettingsLabel = "세부 설정",
  advancedSettingsDescription,
  advancedSettingsOpen,
  defaultAdvancedSettingsOpen = false,
  onAdvancedSettingsOpenChange,
  previewHeader,
  previewLabel = "게임 미리보기",
  previewTools,
  previewStage,
  previewFooter,
  readiness,
  readinessModel,
  readinessLabel = "시작 준비 상태",
  secondaryActions,
  primaryAction,
  primaryActionModel,
  busy = false,
}: SetupWorkspaceProps) {
  const generatedId = useId();
  const idPrefix = `exlab-setup-${generatedId.replaceAll(":", "")}`;
  const titleId = `${idPrefix}-title`;
  const sharedSetupId = `${idPrefix}-shared`;
  const essentialSettingsId = `${idPrefix}-essential`;
  const advancedSettingsId = `${idPrefix}-advanced`;
  const advancedSettingsHelpId = `${idPrefix}-advanced-help`;
  const rootClassName = [
    "exlab-setup-workspace",
    className,
  ].filter(Boolean).join(" ");
  const hasAdvancedSettings = advancedSettings != null;
  const [uncontrolledAdvancedOpen, setUncontrolledAdvancedOpen] =
    useState(defaultAdvancedSettingsOpen);
  const isAdvancedSettingsControlled =
    advancedSettingsOpen !== undefined;
  const resolvedAdvancedSettingsOpen =
    advancedSettingsOpen ?? uncontrolledAdvancedOpen;
  const resolvedBusy = Boolean(
    busy
    || readinessModel?.tone === "busy"
    || primaryActionModel?.busy,
  );

  const handleAdvancedSettingsToggle = (
    event: SyntheticEvent<HTMLDetailsElement>,
  ) => {
    if (!isAdvancedSettingsControlled) {
      setUncontrolledAdvancedOpen(event.currentTarget.open);
    }
    onAdvancedSettingsOpenChange?.(event.currentTarget.open);
  };

  return (
    <section
      className={rootClassName}
      aria-labelledby={titleId}
      aria-busy={resolvedBusy || undefined}
      data-busy={resolvedBusy ? "true" : "false"}
      data-has-advanced={hasAdvancedSettings ? "true" : "false"}
      data-readiness-tone={readinessModel?.tone}
    >
      <aside
        className="exlab-setup-workspace__settings"
        aria-label="설정"
        inert={resolvedBusy || undefined}
      >
        <header className="exlab-setup-workspace__intro">
          {eyebrow != null && (
            <p className="exlab-setup-workspace__eyebrow">{eyebrow}</p>
          )}
          <h1 id={titleId} className="exlab-setup-workspace__title">
            {title}
          </h1>
          {description != null && (
            <div className="exlab-setup-workspace__description">
              {description}
            </div>
          )}
        </header>

        <section
          className="exlab-setup-workspace__setting-group"
          aria-labelledby={sharedSetupId}
        >
          <h2
            id={sharedSetupId}
            className="exlab-setup-workspace__group-title"
          >
            {sharedSetupLabel}
          </h2>
          <div className="exlab-setup-workspace__group-content">
            {sharedSetup}
          </div>
        </section>

        <section
          className="exlab-setup-workspace__setting-group"
          aria-labelledby={essentialSettingsId}
        >
          <h2
            id={essentialSettingsId}
            className="exlab-setup-workspace__group-title"
          >
            {essentialSettingsLabel}
          </h2>
          <div className="exlab-setup-workspace__group-content">
            {essentialSettings}
          </div>
        </section>
      </aside>

      <section
        className="exlab-setup-workspace__preview"
        aria-label={previewLabel}
      >
        <header className="exlab-setup-workspace__preview-bar">
          <div className="exlab-setup-workspace__preview-header">
            {previewHeader}
          </div>
          {previewTools != null && (
            <div
              className="exlab-setup-workspace__preview-tools"
              role="group"
              aria-label={`${previewLabel} 도구`}
            >
              {previewTools}
            </div>
          )}
        </header>

        <div className="exlab-setup-workspace__preview-stage">
          {previewStage}
        </div>

        {previewFooter != null && (
          <footer className="exlab-setup-workspace__preview-footer">
            {previewFooter}
          </footer>
        )}
      </section>

      {hasAdvancedSettings && (
        <section
          className="exlab-setup-workspace__advanced"
          aria-label="세부 설정"
        >
          <details
            open={resolvedAdvancedSettingsOpen}
            onToggle={handleAdvancedSettingsToggle}
          >
            <summary
              id={advancedSettingsId}
              aria-describedby={
                advancedSettingsDescription != null
                  ? advancedSettingsHelpId
                  : undefined
              }
            >
              <span>{advancedSettingsLabel}</span>
              {advancedSettingsDescription != null && (
                <small id={advancedSettingsHelpId}>
                  {advancedSettingsDescription}
                </small>
              )}
            </summary>
            <div
              className="exlab-setup-workspace__advanced-content"
              aria-labelledby={advancedSettingsId}
            >
              {advancedSettings}
            </div>
          </details>
        </section>
      )}

      <footer className="exlab-setup-workspace__action-bar">
        <div
          className="exlab-setup-workspace__readiness"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={readinessLabel}
          aria-busy={resolvedBusy || undefined}
          data-tone={readinessModel?.tone}
        >
          {readinessModel != null ? (
            <SetupReadinessStatus {...readinessModel} />
          ) : (
            readiness
          )}
        </div>
        <div className="exlab-setup-workspace__action-cluster">
          {secondaryActions != null && (
            <div
              className="exlab-setup-workspace__secondary-actions"
              role="group"
              aria-label="보조 실행"
            >
              {secondaryActions}
            </div>
          )}
          <div
            className="exlab-setup-workspace__primary-action"
            role="group"
            aria-label="주요 실행"
          >
            {primaryActionModel != null ? (
              <SetupPrimaryActionButton
                {...primaryActionModel}
                busy={resolvedBusy}
              />
            ) : (
              primaryAction
            )}
          </div>
        </div>
      </footer>
    </section>
  );
}
