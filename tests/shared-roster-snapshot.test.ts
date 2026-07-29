import assert from "node:assert/strict";
import test from "node:test";

import {
  createSharedRosterSnapshot,
  reconcileSharedRosterSnapshot,
  sharedRosterSnapshotText,
} from "../app/_platform/sharedRosterSnapshot";

test("duplicate occurrences keep distinct deterministic identities", () => {
  const first = createSharedRosterSnapshot(
    "레또\n유레카\n레또",
    true,
  );
  const duplicatesDisallowed = createSharedRosterSnapshot(
    "레또\n유레카\n레또",
    false,
  );
  const replay = createSharedRosterSnapshot(
    "레또\n유레카\n레또",
    true,
  );

  assert.deepEqual(replay, first);
  assert.deepEqual(duplicatesDisallowed.participants, first.participants);
  assert.equal(duplicatesDisallowed.allowDuplicateNames, false);
  assert.equal(first.schemaVersion, 2);
  assert.equal(first.revision, 1);
  assert.deepEqual(
    first.participants.map(({ name, ordinal }) => ({ name, ordinal })),
    [
      { name: "레또", ordinal: 1 },
      { name: "유레카", ordinal: 2 },
      { name: "레또", ordinal: 3 },
    ],
  );
  assert.equal(
    new Set(first.participants.map((participant) => participant.id)).size,
    3,
  );
});

test("reorder reuses identities through normalized-name FIFO queues", () => {
  const first = createSharedRosterSnapshot(
    "레또\n유레카\n레또",
    true,
  );
  const reordered = reconcileSharedRosterSnapshot(
    first,
    "레또\n레또\n유레카",
    true,
  );

  assert.equal(reordered.revision, 2);
  assert.deepEqual(
    reordered.participants.map((participant) => participant.id),
    [
      first.participants[0].id,
      first.participants[2].id,
      first.participants[1].id,
    ],
  );
  assert.deepEqual(
    reordered.participants.map((participant) => participant.ordinal),
    [1, 2, 3],
  );
});

test("rename and add create identities while retained names survive removal", () => {
  const first = createSharedRosterSnapshot(
    "알파\n베타\n감마",
    false,
  );
  const edited = reconcileSharedRosterSnapshot(
    first,
    "감마\n델타\n알파",
    false,
  );

  assert.equal(edited.revision, 2);
  assert.equal(edited.participants[0].id, first.participants[2].id);
  assert.equal(edited.participants[2].id, first.participants[0].id);
  assert.ok(
    first.participants.every(
      (participant) => participant.id !== edited.participants[1].id,
    ),
  );
  assert.ok(
    edited.participants.every(
      (participant) => participant.id !== first.participants[1].id,
    ),
  );
});

test("NFKC and whitespace normalization preserve equivalent identities", () => {
  const first = createSharedRosterSnapshot(
    "  ＡＭＯＲＥＴＴＯ  \r\n홍　　길동",
    false,
  );

  assert.deepEqual(
    first.participants.map((participant) => participant.name),
    ["AMORETTO", "홍 길동"],
  );

  const equivalent = reconcileSharedRosterSnapshot(
    first,
    "AMORETTO,홍 \t 길동",
    false,
  );

  assert.strictEqual(equivalent, first);
  assert.deepEqual(
    equivalent.participants.map((participant) => participant.id),
    first.participants.map((participant) => participant.id),
  );
});

test("empty text creates a lossless empty snapshot", () => {
  const empty = createSharedRosterSnapshot(" \r\n, ", false);

  assert.deepEqual(empty.participants, []);
  assert.equal(empty.revision, 1);
  assert.equal(sharedRosterSnapshotText(empty), "");
  assert.strictEqual(
    reconcileSharedRosterSnapshot(empty, "\n", false),
    empty,
  );

  const policyChanged = reconcileSharedRosterSnapshot(empty, "", true);
  assert.equal(policyChanged.revision, 2);
  assert.equal(policyChanged.allowDuplicateNames, true);
  assert.deepEqual(policyChanged.participants, []);
});

test("snapshot text preserves normalized order and duplicate occurrences", () => {
  const snapshot = createSharedRosterSnapshot(
    "  하나  ,둘\n하나",
    true,
  );
  const text = sharedRosterSnapshotText(snapshot);

  assert.equal(text, "하나\n둘\n하나");
  assert.deepEqual(
    createSharedRosterSnapshot(text, true).participants,
    snapshot.participants,
  );
});
