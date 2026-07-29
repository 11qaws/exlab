export const MAX_SHARED_ROSTER_SIZE = 320;
export const MAX_SHARED_NAME_LENGTH = 40;

/**
 * Canonical comparison key shared by every roster editor.
 *
 * Display names keep their casing, but compatibility-equivalent characters,
 * repeated whitespace, and case must not create visually duplicate entries
 * through a different game-specific input path.
 */
export function normalizeSharedRosterName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

export function sharedRosterNameKey(value: string): string {
  return normalizeSharedRosterName(value).toLocaleLowerCase("ko-KR");
}

export function sharedRosterNameLength(value: string): number {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(
      new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(value),
    ).length;
  }

  return Array.from(value).length;
}

export function parseSharedRosterNames(value: string): string[] {
  return value
    .split(/[\r\n,]+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

export type SharedRosterValidation = {
  names: string[];
  duplicateNames: string[];
  error: string | null;
};

export function validateSharedRosterDraft(
  value: string,
  allowDuplicateNames: boolean,
): SharedRosterValidation {
  const names = parseSharedRosterNames(value);
  const tooLong = names.find(
    (name) => sharedRosterNameLength(name) > MAX_SHARED_NAME_LENGTH,
  );
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  names.forEach((name) => {
    const key = sharedRosterNameKey(name);
    if (seen.has(key)) duplicates.add(name);
    else seen.add(key);
  });

  let error: string | null = null;
  if (names.length > MAX_SHARED_ROSTER_SIZE) {
    error = `참가자는 최대 ${MAX_SHARED_ROSTER_SIZE}명까지 저장할 수 있습니다.`;
  } else if (tooLong) {
    error = `이름은 ${MAX_SHARED_NAME_LENGTH}자 이내로 입력해 주세요: ${tooLong}`;
  } else if (duplicates.size > 0 && !allowDuplicateNames) {
    error = `동일 이름을 정리하거나 허용해 주세요: ${[...duplicates].join(", ")}`;
  }

  return {
    names,
    duplicateNames: [...duplicates],
    error,
  };
}
