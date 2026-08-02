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
import {
  streamerThemeCurrentPortraitZoom,
  streamerThemePickerPortraitOffsetY,
} from "./streamerThemePresentation";
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
  readonly presentationState?: "choosing" | "confirming";
}

export interface StreamerThemeCurrentProps {
  readonly value: StreamerThemeId;
  readonly colorMode?: StreamerThemeColorMode;
  readonly assetBasePath?: string;
  readonly className?: string;
  readonly loadImage?: boolean;
}

type ThemeCardStyle = CSSProperties &
  StreamerThemeCssVariables & {
    "--exlab-portrait-focus": string;
    "--exlab-portrait-offset-y": string;
    "--exlab-portrait-zoom": string;
  };

interface ThemePortraitProps {
  readonly fetchPriority?: "high" | "low" | "auto";
  readonly loadImage?: boolean;
  readonly theme: StreamerTheme;
  readonly src: string;
}

function ThemePortrait({
  fetchPriority = "auto",
  loadImage = true,
  theme,
  src,
}: ThemePortraitProps) {
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
      {loadImage ? (
        <>
          {/* Public-base URLs must remain document-relative for static hosting. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            decoding="async"
            draggable={false}
            fetchPriority={fetchPriority}
            height={theme.portrait.height}
            loading="eager"
            onError={() => setImageFailed(true)}
            src={src}
            width={theme.portrait.width}
          />
        </>
      ) : null}
    </span>
  );
}

/**
 * Compact, read-only presentation of the committed shell theme.
 *
 * Theme changes remain an explicit action owned by the host, so the current
 * state is never mistaken for a second picker.
 */
export function StreamerThemeCurrent({
  value,
  colorMode = "light",
  assetBasePath = ".",
  className,
  loadImage = true,
}: StreamerThemeCurrentProps) {
  const theme = STREAMER_THEMES.find((candidate) => candidate.id === value)
    ?? STREAMER_THEMES[0];
  const portraitUrl = resolveStreamerThemePortraitUrl(
    theme,
    assetBasePath,
  );
  const style: ThemeCardStyle = {
    ...streamerThemeCssVariables(theme, colorMode),
    "--exlab-portrait-focus": theme.portrait.focus,
    "--exlab-portrait-offset-y": `${theme.portrait.offsetY}px`,
    "--exlab-portrait-zoom": String(
      streamerThemeCurrentPortraitZoom(theme),
    ),
  };

  return (
    <div
      aria-label={`현재 테마: ${theme.name}`}
      className={["exlab-current-theme", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      style={style}
    >
      <ThemePortrait
        fetchPriority="high"
        key={portraitUrl}
        loadImage={loadImage}
        src={portraitUrl}
        theme={theme}
      />
      <strong>{theme.name}</strong>
    </div>
  );
}

/**
 * Controlled, native-radio theme picker.
 *
 * The host owns persistence and applies `streamerThemeCssVariables` to the
 * common shell. This component only renders the four canonical choices.
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
  presentationState = "choosing",
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
        presentationState === "confirming" ? "is-confirming" : "",
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
            "--exlab-portrait-offset-y": `${streamerThemePickerPortraitOffsetY(theme)}px`,
            "--exlab-portrait-zoom": String(theme.portrait.zoom),
          };

          return (
            <label
              className={`exlab-theme-card-option${
                value === theme.id ? " is-selected" : ""
              }`}
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
                  fetchPriority={
                    value === theme.id ? "high" : "auto"
                  }
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
