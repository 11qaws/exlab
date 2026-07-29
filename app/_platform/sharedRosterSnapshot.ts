import {
  normalizeSharedRosterName,
  parseSharedRosterNames,
  sharedRosterNameKey,
} from "./roster";

export const SHARED_ROSTER_SNAPSHOT_SCHEMA_VERSION = 2 as const;

export type SharedParticipant = {
  readonly id: string;
  readonly name: string;
  readonly ordinal: number;
};

export type SharedRosterSnapshot = {
  readonly schemaVersion: typeof SHARED_ROSTER_SNAPSHOT_SCHEMA_VERSION;
  readonly revision: number;
  readonly participants: readonly SharedParticipant[];
  readonly allowDuplicateNames: boolean;
};

function normalizedRosterNames(rosterText: string): string[] {
  return parseSharedRosterNames(rosterText)
    .map(normalizeSharedRosterName)
    .filter(Boolean);
}

function stableHash(value: string, seed: number): string {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function allocateParticipantId(
  nameKey: string,
  occurrence: number,
  revision: number,
  reservedIds: ReadonlySet<string>,
  usedIds: ReadonlySet<string>,
): string {
  let attempt = 0;

  while (true) {
    const token = `${nameKey}\u001f${occurrence}\u001f${revision}\u001f${attempt}`;
    const id = `shared-v2-${stableHash(token, 0x811c9dc5)}${stableHash(
      token,
      0x9e3779b9,
    )}`;

    if (!reservedIds.has(id) && !usedIds.has(id)) return id;
    attempt += 1;
  }
}

function buildParticipantQueues(
  participants: readonly SharedParticipant[],
): Map<string, SharedParticipant[]> {
  const queues = new Map<string, SharedParticipant[]>();

  participants.forEach((participant) => {
    const key = sharedRosterNameKey(participant.name);
    const queue = queues.get(key) ?? [];
    queue.push(participant);
    queues.set(key, queue);
  });

  return queues;
}

function takeReusableParticipant(
  queue: SharedParticipant[] | undefined,
  usedIds: ReadonlySet<string>,
): SharedParticipant | undefined {
  while (queue && queue.length > 0) {
    const participant = queue.shift();
    if (participant && !usedIds.has(participant.id)) return participant;
  }

  return undefined;
}

function snapshotContentsEqual(
  previousSnapshot: SharedRosterSnapshot,
  participants: readonly SharedParticipant[],
  allowDuplicateNames: boolean,
): boolean {
  if (
    previousSnapshot.allowDuplicateNames !== allowDuplicateNames ||
    previousSnapshot.participants.length !== participants.length
  ) {
    return false;
  }

  return participants.every((participant, index) => {
    const previous = previousSnapshot.participants[index];
    return (
      previous.id === participant.id &&
      previous.name === participant.name &&
      previous.ordinal === participant.ordinal
    );
  });
}

function buildSharedRosterSnapshot(
  rosterText: string,
  allowDuplicateNames: boolean,
  previousSnapshot?: SharedRosterSnapshot,
): SharedRosterSnapshot {
  const names = normalizedRosterNames(rosterText);
  const revision = previousSnapshot ? previousSnapshot.revision + 1 : 1;
  const previousQueues = buildParticipantQueues(
    previousSnapshot?.participants ?? [],
  );
  const reservedIds = new Set(
    previousSnapshot?.participants.map((participant) => participant.id) ?? [],
  );
  const usedIds = new Set<string>();
  const occurrences = new Map<string, number>();

  const participants = names.map((name, index): SharedParticipant => {
    const nameKey = sharedRosterNameKey(name);
    const occurrence = (occurrences.get(nameKey) ?? 0) + 1;
    occurrences.set(nameKey, occurrence);

    const reusable = takeReusableParticipant(
      previousQueues.get(nameKey),
      usedIds,
    );
    const id =
      reusable?.id ??
      allocateParticipantId(
        nameKey,
        occurrence,
        revision,
        reservedIds,
        usedIds,
      );
    usedIds.add(id);

    return {
      id,
      name,
      ordinal: index + 1,
    };
  });

  if (
    previousSnapshot &&
    snapshotContentsEqual(
      previousSnapshot,
      participants,
      allowDuplicateNames,
    )
  ) {
    return previousSnapshot;
  }

  return {
    schemaVersion: SHARED_ROSTER_SNAPSHOT_SCHEMA_VERSION,
    revision,
    participants,
    allowDuplicateNames,
  };
}

/**
 * Migrates the current text roster into the shared schema-v2 identity model.
 * The same initial input always produces the same participant identifiers.
 */
export function createSharedRosterSnapshot(
  rosterText: string,
  allowDuplicateNames: boolean,
): SharedRosterSnapshot {
  return buildSharedRosterSnapshot(rosterText, allowDuplicateNames);
}

/**
 * Reconciles an edited text roster with the last shared snapshot.
 *
 * Existing identities are consumed from a FIFO queue for each normalized name,
 * so reordering names preserves identity and duplicate occurrences remain
 * distinct. A rename creates a new identity because text alone cannot prove
 * that it represents the same person.
 */
export function reconcileSharedRosterSnapshot(
  previousSnapshot: SharedRosterSnapshot,
  rosterText: string,
  allowDuplicateNames: boolean,
): SharedRosterSnapshot {
  return buildSharedRosterSnapshot(
    rosterText,
    allowDuplicateNames,
    previousSnapshot,
  );
}

export function sharedRosterSnapshotText(
  snapshot: SharedRosterSnapshot,
): string {
  return snapshot.participants
    .map((participant) => participant.name)
    .join("\n");
}
