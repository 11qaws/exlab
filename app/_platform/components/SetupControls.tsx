import type { ReactNode } from "react";

export const SETUP_READINESS_TONES = [
  "ready",
  "blocked",
  "busy",
  "recoverable",
] as const;

export type SetupReadinessTone =
  (typeof SETUP_READINESS_TONES)[number];

export type SetupReadinessModel = {
  tone: SetupReadinessTone;
  label: ReactNode;
  detail?: ReactNode;
};

export type SetupPrimaryActionModel = {
  label: ReactNode;
  disabled: boolean;
  busy: boolean;
  onPress: () => void;
};

export const SETUP_OPTION_GROUP_KINDS = [
  "text",
  "choice",
  "number",
  "toggle",
] as const;

export type SetupOptionGroupKind =
  (typeof SETUP_OPTION_GROUP_KINDS)[number];

export const SETUP_CHOICE_CONTROL_VARIANTS = [
  "segmented",
  "scroll-strip",
] as const;

export type SetupChoiceControlVariant =
  (typeof SETUP_CHOICE_CONTROL_VARIANTS)[number];

export type SetupReadinessStatusProps = SetupReadinessModel;

export function SetupReadinessStatus({
  tone,
  label,
  detail,
}: SetupReadinessStatusProps) {
  return (
    <div
      className="exlab-setup-readiness-status"
      data-tone={tone}
    >
      <div className="exlab-setup-readiness-status__label">
        <span
          className="exlab-setup-readiness-status__marker"
          aria-hidden="true"
        />
        <span>{label}</span>
      </div>
      {detail != null && (
        <div className="exlab-setup-readiness-status__detail">
          {detail}
        </div>
      )}
    </div>
  );
}

export type SetupPrimaryActionButtonProps =
  SetupPrimaryActionModel;

export function SetupPrimaryActionButton({
  label,
  disabled,
  busy,
  onPress,
}: SetupPrimaryActionButtonProps) {
  const unavailable = disabled || busy;

  return (
    <button
      type="button"
      className="exlab-setup-primary-action-button"
      disabled={unavailable}
      aria-busy={busy || undefined}
      data-busy={busy ? "true" : "false"}
      onClick={onPress}
    >
      {label}
    </button>
  );
}

export type SetupChoiceControlProps = {
  variant: SetupChoiceControlVariant;
  ariaLabel: string;
  children?: ReactNode;
  className?: string;
};

/**
 * Shared geometry for finite setup choices. Two-choice settings use the
 * segmented variant; an open-ended list such as Showdown groups uses the
 * scroll strip while keeping the same control height and button rhythm.
 */
export function SetupChoiceControl({
  variant,
  ariaLabel,
  children,
  className,
}: SetupChoiceControlProps) {
  const rootClassName = [
    "exlab-setup-choice-control",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div
      className={rootClassName}
      data-choice-variant={variant}
      role="group"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}

export type SetupOptionGroupProps = {
  kind: SetupOptionGroupKind;
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/**
 * Groups setup options by interaction type without adding another card
 * surface. The kind controls only alignment and sizing; each child continues
 * to own its form state and accessible name.
 */
export function SetupOptionGroup({
  kind,
  label,
  description,
  children,
  className,
}: SetupOptionGroupProps) {
  const rootClassName = [
    "exlab-setup-option-group",
    className,
  ].filter(Boolean).join(" ");

  return (
    <fieldset
      className={rootClassName}
      data-option-kind={kind}
    >
      <legend className="exlab-setup-option-group__legend">
        <span>{label}</span>
        {description != null && <small>{description}</small>}
      </legend>
      <div className="exlab-setup-option-group__content">
        {children}
      </div>
    </fieldset>
  );
}

export type SetupOptionRowProps = {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  htmlFor?: string;
  className?: string;
};

/**
 * A single aligned row inside SetupOptionGroup. For a number group, put the
 * decrement button, current value and increment button in children order.
 */
export function SetupOptionRow({
  label,
  description,
  children,
  htmlFor,
  className,
}: SetupOptionRowProps) {
  const rootClassName = [
    "exlab-setup-option-row",
    className,
  ].filter(Boolean).join(" ");
  const copy = (
    <>
      <span className="exlab-setup-option-row__label">
        {label}
      </span>
      {description != null && (
        <small className="exlab-setup-option-row__description">
          {description}
        </small>
      )}
    </>
  );

  return (
    <div className={rootClassName}>
      {htmlFor != null ? (
        <label
          className="exlab-setup-option-row__copy"
          htmlFor={htmlFor}
        >
          {copy}
        </label>
      ) : (
        <div className="exlab-setup-option-row__copy">
          {copy}
        </div>
      )}
      <div className="exlab-setup-option-row__control">
        {children}
      </div>
    </div>
  );
}
