"use client";

import {
  useId,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import {
  STREAMER_THEMES,
  resolveStreamerThemePortraitUrl,
  streamerThemeCssVariables,
  type StreamerTheme,
  type StreamerThemeColorMode,
  type StreamerThemeCssVariables,
  type StreamerThemeId,
} from "./streamerThemes";
import "./streamer-theme-picker.css";

export interface StreamerThemePickerProps {
  readonly value: StreamerThemeId;
  readonly onChange: (themeId: StreamerThemeId) => void;
  readonly colorMode?: StreamerThemeColorMode;
  readonly disabled?: boolean;
  readonly name?: string;
  readonly legend?: string;
  readonly description?: string;
  readonly assetBasePath?: string;
  readonly className?: string;
}

type ThemeCardStyle = CSSProperties &
  StreamerThemeCssVariables & {
    "--exlab-portrait-focus": string;
    "--exlab-portrait-offset-y": string;
    "--exlab-portrait-zoom": string;
  };

interface ThemePortraitProps {
  readonly theme: StreamerTheme;
  readonly src: string;
}

function ThemePortrait({ theme, src }: ThemePortraitProps) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <span
      aria-hidden="true"
      className={`exlab-theme-card-portrait${
        imageFailed ? " is-fallback" : ""
      }`}
    >
      <span className="exlab-theme-card-fallback">
        {theme.portrait.fallback}
      </span>
      {/* Public-base URLs must remain document-relative for static hosting. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        draggable={false}
        loading="lazy"
        onError={() => setImageFailed(true)}
        src={src}
      />
    </span>
  );
}

/**
 * Controlled, native-radio theme picker.
 *
 * The host owns persistence and applies `streamerThemeCssVariables` to the
 * common shell. This component only renders the five canonical choices.
 */
export function StreamerThemePicker({
  value,
  onChange,
  colorMode = "light",
  disabled = false,
  name,
  legend = "스트리머 테마",
  description = "전체 화면에 적용할 테마를 선택합니다.",
  assetBasePath = ".",
  className,
}: StreamerThemePickerProps) {
  const generatedId = useId();
  const inputName = name ?? `streamer-theme-${generatedId}`;
  const descriptionId = `streamer-theme-description-${generatedId}`;

  const handleChange =
    (themeId: StreamerThemeId) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      if (event.currentTarget.checked) onChange(themeId);
    };

  return (
    <fieldset
      aria-describedby={description ? descriptionId : undefined}
      className={[
        "exlab-streamer-theme-picker",
        disabled ? "is-disabled" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled}
    >
      <legend>{legend}</legend>
      {description ? <p id={descriptionId}>{description}</p> : null}

      <div className="exlab-streamer-theme-list">
        {STREAMER_THEMES.map((theme) => {
          const portraitUrl = resolveStreamerThemePortraitUrl(
            theme,
            assetBasePath,
          );
          const cardStyle: ThemeCardStyle = {
            ...streamerThemeCssVariables(theme, colorMode),
            "--exlab-portrait-focus": theme.portrait.focus,
            "--exlab-portrait-offset-y": `${theme.portrait.offsetY}px`,
            "--exlab-portrait-zoom": String(theme.portrait.zoom),
          };

          return (
            <label
              className="exlab-theme-card-option"
              data-theme-id={theme.id}
              key={theme.id}
              style={cardStyle}
              title={theme.name}
            >
              <input
                aria-label={theme.name}
                checked={value === theme.id}
                className="exlab-theme-card-radio"
                name={inputName}
                onChange={handleChange(theme.id)}
                type="radio"
                value={theme.id}
              />

              <span className="exlab-theme-card">
                <span
                  aria-hidden="true"
                  className="exlab-theme-card-rail"
                />
                <ThemePortrait
                  key={portraitUrl}
                  src={portraitUrl}
                  theme={theme}
                />
                <span
                  aria-hidden="true"
                  className="exlab-theme-card-scrim"
                />
                <span className="exlab-theme-card-copy">
                  <strong>{theme.name}</strong>
                  <span>{theme.subtitle}</span>
                </span>
                <span
                  aria-hidden="true"
                  className="exlab-theme-card-check"
                />
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
