import type {
  Candidate,
  CandidateGroup,
  ParticipantTheme,
  RacePlan,
  RaceSimulation,
  RosterOptions,
  RosterValidation,
} from "./types";

export const MIN_PARTICIPANTS = 2;
export const MAX_GROUP_SIZE = 10;
export const MAX_PARTICIPANTS = MAX_GROUP_SIZE;
export const MAX_ROSTER_SIZE = 320;

export const PARTICIPANT_THEMES: readonly ParticipantTheme[] = [
  {
    key: "rose",
    primary: "#e84f83",
    onPrimary: "#2a0c16",
    surface: "#fdeaf1",
    onSurface: "#4a1729",
    border: "#c73468",
  },
  {
    key: "mint",
    primary: "#2fbfa7",
    onPrimary: "#062c25",
    surface: "#e1f7f2",
    onSurface: "#103d35",
    border: "#1b8d7a",
  },
  {
    key: "sun",
    primary: "#f2b63d",
    onPrimary: "#302000",
    surface: "#fff3d7",
    onSurface: "#493308",
    border: "#b67c0c",
  },
  {
    key: "blue",
    primary: "#568ce8",
    onPrimary: "#071a38",
    surface: "#e8f0ff",
    onSurface: "#152e59",
    border: "#376ac1",
  },
  {
    key: "violet",
    primary: "#9a71e8",
    onPrimary: "#1d0d3a",
    surface: "#f1eaff",
    onSurface: "#34205e",
    border: "#7146bd",
  },
  {
    key: "orange",
    primary: "#f17a45",
    onPrimary: "#321204",
    surface: "#ffeadf",
    onSurface: "#54230d",
    border: "#bd5427",
  },
  {
    key: "sky",
    primary: "#4baedc",
    onPrimary: "#062635",
    surface: "#e4f5fc",
    onSurface: "#153d50",
    border: "#287fa8",
  },
  {
    key: "berry",
    primary: "#d8648c",
    onPrimary: "#300d19",
    surface: "#fbe9ef",
    onSurface: "#522033",
    border: "#a93d63",
  },
  {
    key: "leaf",
    primary: "#77af45",
    onPrimary: "#142805",
    surface: "#edf6e4",
    onSurface: "#2a4313",
    border: "#508527",
  },
  {
    key: "lilac",
    primary: "#c687e6",
    onPrimary: "#281033",
    surface: "#f7eafd",
    onSurface: "#482057",
    border: "#9555b6",
  },
];

function linearChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const value = color.replace("#", "");
    const channels = [0, 2, 4].map((offset) =>
      Number.parseInt(value.slice(offset, offset + 2), 16),
    );
    return (
      0.2126 * linearChannel(channels[0]) +
      0.7152 * linearChannel(channels[1]) +
      0.0722 * linearChannel(channels[2])
    );
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

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

export function parseRoster(
  input: string,
  options: RosterOptions = {},
): RosterValidation {
  const names = input
    .split(/[\n,]+/)
    .map((name) => name.trim())
    .filter(Boolean);

  const acceptedNames = names.slice(0, MAX_ROSTER_SIZE);
  const overflowNames = names.slice(MAX_ROSTER_SIZE);
  const duplicateCounts = new Map<string, number>();
  const duplicateNames = Array.from(
    acceptedNames.reduce((duplicates, name) => {
      const key = name.toLocaleLowerCase("ko-KR");
      const seen = duplicateCounts.get(key) ?? 0;
      duplicateCounts.set(key, seen + 1);
      if (seen > 0) duplicates.add(name);
      return duplicates;
    }, new Set<string>()),
  );
  duplicateCounts.clear();

  const candidates = acceptedNames.map((name, index) => {
    const duplicateKey = name.toLocaleLowerCase("ko-KR");
    const duplicateIndex = (duplicateCounts.get(duplicateKey) ?? 0) + 1;
    duplicateCounts.set(duplicateKey, duplicateIndex);
    const identity = `${name}:${index}:${duplicateIndex}`;
    return {
      id: `candidate-${index + 1}-${hashText(identity).toString(36)}`,
      name,
      theme: PARTICIPANT_THEMES[index % PARTICIPANT_THEMES.length],
      number: index + 1,
    };
  });

  if (overflowNames.length > 0) {
    return {
      candidates,
      overflowNames,
      duplicateNames,
      isValid: false,
      message: `전체 명단은 ${MAX_ROSTER_SIZE}명까지 가능해요. ${overflowNames.length}명을 정리해 주세요.`,
    };
  }

  if (duplicateNames.length > 0 && !options.allowDuplicateNames) {
    return {
      candidates,
      overflowNames,
      duplicateNames,
      isValid: false,
      message: `동일한 이름 ${duplicateNames.join(", ")}을(를) 정리하거나 허용 옵션을 켜 주세요.`,
    };
  }

  if (candidates.length < MIN_PARTICIPANTS) {
    return {
      candidates,
      overflowNames,
      duplicateNames,
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
    duplicateNames,
    isValid: true,
    message:
      candidates.length > MAX_GROUP_SIZE
        ? `${candidates.length}명을 조별 경기로 편성할 수 있어요.`
        : "경기 준비 완료",
  };
}

export function minimumGroupCount(participantCount: number): number {
  return Math.max(1, Math.ceil(participantCount / MAX_GROUP_SIZE));
}

export function maximumGroupCount(participantCount: number): number {
  return Math.max(
    minimumGroupCount(participantCount),
    Math.floor(participantCount / MIN_PARTICIPANTS),
  );
}

export function splitCandidatesIntoGroups(
  candidates: Candidate[],
  requestedGroupCount: number,
): CandidateGroup[] {
  if (candidates.length < MIN_PARTICIPANTS) return [];
  const minimum = minimumGroupCount(candidates.length);
  const maximum = maximumGroupCount(candidates.length);
  const groupCount = Math.min(
    maximum,
    Math.max(minimum, Math.trunc(requestedGroupCount) || minimum),
  );
  const baseSize = Math.floor(candidates.length / groupCount);
  const remainder = candidates.length % groupCount;
  let cursor = 0;

  return Array.from({ length: groupCount }, (_, index) => {
    const size = baseSize + (index < remainder ? 1 : 0);
    const group = {
      id: `group-${index + 1}`,
      index,
      candidates: candidates.slice(cursor, cursor + size),
    };
    cursor += size;
    return group;
  });
}

export function shortName(name: string, max = 8): string {
  const characters = Array.from(name);
  return characters.length <= max
    ? name
    : `${characters.slice(0, Math.max(1, max - 1)).join("")}…`;
}

export function createRaceSlotAssignment(
  candidates: readonly Candidate[],
  raceSeed: string,
): Record<string, string> {
  if (
    candidates.length < MIN_PARTICIPANTS ||
    candidates.length > MAX_PARTICIPANTS
  ) {
    throw new Error("참가자 수는 2명 이상 10명 이하여야 합니다.");
  }

  return Object.fromEntries(
    shuffleSeeded(candidates, `${raceSeed}:slots`).map(
      (candidate, index) => [`slot-${index + 1}`, candidate.id],
    ),
  );
}

export function buildRacePlan(
  title: string,
  candidates: Candidate[],
  simulation: RaceSimulation,
  seeds: { raceSeed: string; layoutSeed: string },
  winnerCount = 1,
): RacePlan {
  if (
    candidates.length < MIN_PARTICIPANTS ||
    candidates.length > MAX_PARTICIPANTS
  ) {
    throw new Error("참가자 수는 2명 이상 10명 이하여야 합니다.");
  }
  if (
    !Number.isInteger(winnerCount) ||
    winnerCount < 1 ||
    winnerCount > candidates.length
  ) {
    throw new Error("당첨 인원은 1명 이상 참가자 수 이하여야 합니다.");
  }
  if (simulation.targetFinishCount !== winnerCount) {
    throw new Error("물리 경기와 결과 계획의 당첨 인원이 일치하지 않습니다.");
  }

  const slotToCandidateId = { ...simulation.slotToCandidateId };
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const assignedCandidateIds = Object.values(slotToCandidateId);
  const hasExactSlots = candidates.every(
    (_, index) => slotToCandidateId[`slot-${index + 1}`],
  );
  if (
    Object.keys(slotToCandidateId).length !== candidates.length ||
    assignedCandidateIds.length !== candidates.length ||
    new Set(assignedCandidateIds).size !== candidates.length ||
    !assignedCandidateIds.every((candidateId) =>
      candidateIds.has(candidateId)
    ) ||
    !hasExactSlots
  ) {
    throw new Error("물리 경기 전에 확정한 참가자 슬롯이 유효하지 않습니다.");
  }

  const visibleOrder =
    simulation.frames.at(-1)?.rankedSlotIds ?? simulation.fullFinishOrder;
  const rankedCandidateIds = visibleOrder.map(
    (slotId) => slotToCandidateId[slotId],
  );

  if (rankedCandidateIds.some((candidateId) => !candidateId)) {
    throw new Error("출발 슬롯과 참가자 배정을 완성하지 못했습니다.");
  }

  return {
    runId: createSeed("run"),
    title: title.trim() || "오늘의 Race",
    raceSeed: seeds.raceSeed,
    layoutSeed: seeds.layoutSeed,
    createdAt: new Date().toISOString(),
    candidates,
    slotToCandidateId,
    rankedCandidateIds,
    winnerCount,
    winnerIds: rankedCandidateIds.slice(0, winnerCount),
    simulation,
  };
}
