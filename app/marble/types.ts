export type ResultMode = "preselected" | "physical";

export type Candidate = {
  id: string;
  name: string;
  color: string;
  number: number;
};

export type RosterValidation = {
  candidates: Candidate[];
  overflowNames: string[];
  isValid: boolean;
  message: string;
};

export type MarblePose = {
  slotId: string;
  x: number;
  y: number;
  angle: number;
};

export type RaceFrame = {
  poses: MarblePose[];
  rankedSlotIds: string[];
  finishedSlotIds: string[];
  rotatingBarAngles: number[];
};

export type RaceSimulation = {
  frames: RaceFrame[];
  fullFinishOrder: string[];
  winnerFrameIndex: number;
  durationMs: number;
  layoutShift: number;
  simulationSteps: number;
  physicallyFinishedCount: number;
  timedOut: boolean;
};

export type RacePlan = {
  runId: string;
  title: string;
  resultMode: ResultMode;
  raceSeed: string;
  resultSeed: string;
  layoutSeed: string;
  createdAt: string;
  candidates: Candidate[];
  slotToCandidateId: Record<string, string>;
  rankedCandidateIds: string[];
  winnerId: string;
  simulation: RaceSimulation;
};

export type StoredRaceResult = {
  runId: string;
  title: string;
  resultMode: ResultMode;
  raceSeed: string;
  layoutSeed: string;
  createdAt: string;
  winnerName: string;
  rankedNames: string[];
};
