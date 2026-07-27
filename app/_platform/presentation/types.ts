export const RESULT_PRESENTATION_PHASES = [
  "live",
  "evidence",
  "hero",
  "docking",
  "settled",
] as const;

export type ResultPresentationPhase =
  (typeof RESULT_PRESENTATION_PHASES)[number];

export type DeepReadonly<T> =
  T extends (...args: never[]) => unknown
    ? T
    : T extends readonly (infer TItem)[]
      ? readonly DeepReadonly<TItem>[]
      : T extends object
        ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
        : T;

/**
 * A game-owned point expressed inside the persistent stage, independent of the
 * browser viewport and result-rail width.
 */
export type StagePresentationAnchor = Readonly<{
  coordinateSpace: "stage-normalized";
  xRatio: number;
  yRatio: number;
  sourceId?: string;
}>;

export type ResultPresentationToken = Readonly<{
  runId: string;
  presentationId: string;
}>;

/**
 * Immutable, game-owned data projected into the common result presenter.
 *
 * The platform may arrange and animate this data, but must never use it to
 * calculate or change the committed result.
 */
export type ResultPresentationProjection<
  TWinner = unknown,
  TRankingRow = unknown,
  TSummary = unknown,
> = Readonly<{
  gameId: string;
  runId: string;
  presentationId: string;
  committedAt: string;
  anchor: StagePresentationAnchor;
  primaryWinners: readonly DeepReadonly<TWinner>[];
  rankingRows: readonly DeepReadonly<TRankingRow>[];
  summary: DeepReadonly<TSummary>;
}>;

export type ResultPresentationProjectionInput<
  TWinner = unknown,
  TRankingRow = unknown,
  TSummary = unknown,
> = {
  gameId: string;
  runId: string;
  presentationId: string;
  committedAt: string;
  anchor: StagePresentationAnchor;
  primaryWinners: readonly TWinner[];
  rankingRows: readonly TRankingRow[];
  summary: TSummary;
};

function cloneAndFreezeProjectionValue<T>(value: T): DeepReadonly<T> {
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item) => cloneAndFreezeProjectionValue(item)),
    ) as DeepReadonly<T>;
  }

  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        "Result presentation values must use plain objects and arrays.",
      );
    }

    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          cloneAndFreezeProjectionValue(item),
        ]),
      ),
    ) as DeepReadonly<T>;
  }

  return value as DeepReadonly<T>;
}

function assertNonBlank(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be blank.`);
  }
}

function assertRatio(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be a finite number from 0 to 1.`);
  }
}

export function createStagePresentationAnchor(
  input: Omit<StagePresentationAnchor, "coordinateSpace">,
): StagePresentationAnchor {
  assertRatio(input.xRatio, "xRatio");
  assertRatio(input.yRatio, "yRatio");
  if (input.sourceId !== undefined) {
    assertNonBlank(input.sourceId, "sourceId");
  }

  return Object.freeze({
    coordinateSpace: "stage-normalized" as const,
    xRatio: input.xRatio,
    yRatio: input.yRatio,
    ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
  });
}

/**
 * Deep-copies and freezes the projection DTO so later game-state mutations
 * cannot change data already handed to the presenter.
 */
export function createResultPresentationProjection<
  TWinner,
  TRankingRow,
  TSummary,
>(
  input: ResultPresentationProjectionInput<TWinner, TRankingRow, TSummary>,
): ResultPresentationProjection<TWinner, TRankingRow, TSummary> {
  assertNonBlank(input.gameId, "gameId");
  assertNonBlank(input.runId, "runId");
  assertNonBlank(input.presentationId, "presentationId");
  assertNonBlank(input.committedAt, "committedAt");

  return Object.freeze({
    gameId: input.gameId,
    runId: input.runId,
    presentationId: input.presentationId,
    committedAt: input.committedAt,
    anchor: cloneAndFreezeProjectionValue(input.anchor),
    primaryWinners: cloneAndFreezeProjectionValue(input.primaryWinners),
    rankingRows: cloneAndFreezeProjectionValue(input.rankingRows),
    summary: cloneAndFreezeProjectionValue(input.summary),
  }) as ResultPresentationProjection<TWinner, TRankingRow, TSummary>;
}
