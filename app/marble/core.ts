import type {
  Candidate,
  RacePlan,
  RaceSimulation,
  ResultMode,
  RosterValidation,
} from "./types";

export const MIN_PARTICIPANTS = 2;
export const MAX_PARTICIPANTS = 10;

const MARBLE_COLORS = [
  "#ff6f9f",
  "#5ed6bc",
  "#ffd166",
  "#7aa7ff",
  "#b98cff",
  "#ff986a",
  "#68c7f4",
  "#ef799f",
  "#9aca68",
  "#e9a7ff",
];

export function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createSeed(prefix = "race"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createPrng(seed: string): () => number {
  let state = hashText(seed) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleSeeded<T>(items: readonly T[], seed: string): T[] {
  const result = [...items];
  const random = createPrng(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function parseRoster(input: string): RosterValidation {
  const names = input
    .split(/[\n,]+/)
    .map((name) => name.trim())
    .filter(Boolean);

  const acceptedNames = names.slice(0, MAX_PARTICIPANTS);
  const overflowNames = names.slice(MAX_PARTICIPANTS);
  const duplicateCounts = new Map<string, number>();

  const candidates = acceptedNames.map((name, index) => {
    const duplicateIndex = (duplicateCounts.get(name) ?? 0) + 1;
    duplicateCounts.set(name, duplicateIndex);
    const identity = `${name}:${index}:${duplicateIndex}`;
    return {
      id: `candidate-${index + 1}-${hashText(identity).toString(36)}`,
      name,
      color: MARBLE_COLORS[index % MARBLE_COLORS.length],
      number: index + 1,
    };
  });

  if (overflowNames.length > 0) {
    return {
      candidates,
      overflowNames,
      isValid: false,
      message: `참가자는 10명까지 가능해요. ${overflowNames.length}명을 정리해 주세요.`,
    };
  }

  if (candidates.length < MIN_PARTICIPANTS) {
    return {
      candidates,
      overflowNames,
      isValid: false,
      message:
        candidates.length === 0
          ? "참가자를 두 명 이상 추가해 주세요."
          : "한 명 더 필요해요.",
    };
  }

  return {
    candidates,
    overflowNames,
    isValid: true,
    message:
      candidates.length === MAX_PARTICIPANTS
        ? "모든 자리를 채웠어요."
        : "경기 준비 완료",
  };
}

export function shortName(name: string, max = 8): string {
  const characters = Array.from(name);
  return characters.length <= max
    ? name
    : `${characters.slice(0, Math.max(1, max - 1)).join("")}…`;
}

export function buildRacePlan(
  title: string,
  candidates: Candidate[],
  resultMode: ResultMode,
  simulation: RaceSimulation,
  seeds: { raceSeed: string; resultSeed: string; layoutSeed: string },
): RacePlan {
  if (
    candidates.length < MIN_PARTICIPANTS ||
    candidates.length > MAX_PARTICIPANTS
  ) {
    throw new Error("참가자 수는 2명 이상 10명 이하여야 합니다.");
  }

  const startSlotIds = simulation.fullFinishOrder;
  const slotToCandidateId: Record<string, string> = {};

  if (resultMode === "preselected") {
    const resultOrder = shuffleSeeded(candidates, seeds.resultSeed);
    startSlotIds.forEach((slotId, index) => {
      slotToCandidateId[slotId] = resultOrder[index].id;
    });
  } else {
    const startOrder = shuffleSeeded(candidates, `${seeds.raceSeed}:slots`);
    startOrder.forEach((candidate, index) => {
      slotToCandidateId[`slot-${index + 1}`] = candidate.id;
    });
  }

  const rankedCandidateIds = simulation.fullFinishOrder.map(
    (slotId) => slotToCandidateId[slotId],
  );

  if (rankedCandidateIds.some((candidateId) => !candidateId)) {
    throw new Error("출발 슬롯과 참가자 배정을 완성하지 못했습니다.");
  }

  return {
    runId: createSeed("run"),
    title: title.trim() || "오늘의 마블 경기",
    resultMode,
    raceSeed: seeds.raceSeed,
    resultSeed: seeds.resultSeed,
    layoutSeed: seeds.layoutSeed,
    createdAt: new Date().toISOString(),
    candidates,
    slotToCandidateId,
    rankedCandidateIds,
    winnerId: rankedCandidateIds[0],
    simulation,
  };
}

