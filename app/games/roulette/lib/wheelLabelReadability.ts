export type WheelSliceLabelKind = 'name' | 'hidden';

export interface WheelSliceLabelDecision {
  kind: WheelSliceLabelKind;
  text: string;
  fontSizeInViewBox: number;
}

export interface WheelSliceLabelInput {
  participant: string;
  participantCount: number;
  sliceAngle: number;
  labelRadius: number;
  wheelDiameter: number | null;
  wheelRadius?: number;
  viewBoxDiameter?: number;
}

const DEFAULT_WHEEL_RADIUS = 304;
const DEFAULT_VIEWBOX_DIAMETER = 600;
const MIN_COMPACT_RENDERED_FONT = 10;
const MIN_REGULAR_RENDERED_FONT = 9;

function labelGraphemes(value: string) {
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(
      new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(value),
      ({ segment }) => segment,
    );
  }

  return Array.from(value);
}

export function compactWheelName(name: string, count: number) {
  const normalized = name.trim() || '이름 없음';
  const graphemes = labelGraphemes(normalized);
  const limit = count <= 10 ? 11 : count <= 18 ? 8 : count <= 28 ? 5 : 3;

  return graphemes.length > limit
    ? `${graphemes.slice(0, Math.max(1, limit - 1)).join('')}…`
    : normalized;
}

function estimateLabelUnits(label: string) {
  return labelGraphemes(label).reduce((total, character) => {
    const isWide = character.length > 1
      || /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\uff01-\uff60]/u.test(character);
    return total + (isWide ? 1 : 0.62);
  }, 0);
}

function hasEnoughSpace({
  label,
  fontSizeInViewBox,
  labelRadius,
  scale,
  sliceAngle,
  wheelRadius,
}: {
  label: string;
  fontSizeInViewBox: number;
  labelRadius: number;
  scale: number;
  sliceAngle: number;
  wheelRadius: number;
}) {
  const renderedFontSize = fontSizeInViewBox * scale;
  const arcLength = (sliceAngle * Math.PI / 180) * labelRadius * scale;
  if (arcLength < renderedFontSize * 1.45) return false;

  const radialHalfSpan = Math.min(
    labelRadius - 68,
    wheelRadius - labelRadius - 14,
  );
  const availableTextWidth = Math.max(0, radialHalfSpan * 2 * scale);
  const estimatedTextWidth = estimateLabelUnits(label) * renderedFontSize;
  return estimatedTextWidth <= availableTextWidth * 0.94;
}

export function resolveWheelSliceLabel({
  participant,
  participantCount,
  sliceAngle,
  labelRadius,
  wheelDiameter,
  wheelRadius = DEFAULT_WHEEL_RADIUS,
  viewBoxDiameter = DEFAULT_VIEWBOX_DIAMETER,
}: WheelSliceLabelInput): WheelSliceLabelDecision {
  if (sliceAngle <= 1 || participantCount <= 0) {
    return { kind: 'hidden', text: '', fontSizeInViewBox: 0 };
  }

  const name = compactWheelName(participant, participantCount);
  const baseNameFont = Math.max(10, Math.min(20, 170 / participantCount));

  if (wheelDiameter !== null && wheelDiameter > 0) {
    const scale = wheelDiameter / viewBoxDiameter;
    const minimumRenderedFont = wheelDiameter < 380
      ? MIN_COMPACT_RENDERED_FONT
      : MIN_REGULAR_RENDERED_FONT;
    const readableNameFont = Math.min(
      34,
      Math.max(baseNameFont, minimumRenderedFont / scale),
    );
    if (
      readableNameFont * scale >= minimumRenderedFont
      && hasEnoughSpace({
        label: name,
        fontSizeInViewBox: readableNameFont,
        labelRadius,
        scale,
        sliceAngle,
        wheelRadius,
      })
    ) {
      return {
        kind: 'name',
        text: name,
        fontSizeInViewBox: readableNameFont,
      };
    }

    return { kind: 'hidden', text: '', fontSizeInViewBox: 0 };
  }

  if (hasEnoughSpace({
    label: name,
    fontSizeInViewBox: baseNameFont,
    labelRadius,
    scale: 1,
    sliceAngle,
    wheelRadius,
  })) {
    return { kind: 'name', text: name, fontSizeInViewBox: baseNameFont };
  }

  return { kind: 'hidden', text: '', fontSizeInViewBox: 0 };
}
