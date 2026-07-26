export type ResultMode = "preselected" | "physical";

export type ParticipantTheme = {
  key: string;
  primary: string;
  onPrimary: string;
  surface: string;
  onSurface: string;
  border: string;
};

export type Candidate = {
  id: string;
  name: string;
  theme: ParticipantTheme;
  number: number;
};

export type RosterValidation = {
  candidates: Candidate[];
  overflowNames: string[];
  duplicateNames: string[];
  isValid: boolean;
  message: string;
};

export type RosterOptions = {
  allowDuplicateNames?: boolean;
};

export type CandidateGroup = {
  id: string;
  index: number;
  candidates: Candidate[];
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

export type SpinnerDynamics = {
  baseAngle: number;
  angularSpeed: number;
};

export type WindPulse = {
  startStep: number;
  endStep: number;
  gravityX: number;
};

export type ForceZone = {
  startY: number;
  endY: number;
  forceX: number;
  forceY: number;
};

export type CatchUpDynamics = {
  startGap: number;
  maxGap: number;
  maxForceY: number;
};

export type RaceDynamics = {
  fingerprint: string;
  gravityScale: number;
  marbleRestitution: number;
  obstacleRestitution: number;
  pinRestitution: number;
  rotatingBars: SpinnerDynamics[];
  windPulses: WindPulse[];
  forceZones: ForceZone[];
  catchUp: CatchUpDynamics;
};

export type RaceSimulation = {
  frames: RaceFrame[];
  fullFinishOrder: string[];
  firstFinishFrameIndex: number;
  awardFrameIndex: number;
  targetFinishCount: number;
  visibleFinishedCount: number;
  durationMs: number;
  layoutShift: number;
  simulationSteps: number;
  physicallyFinishedCount: number;
  timedOut: boolean;
  dynamics: RaceDynamics;
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
  winnerCount: number;
  winnerIds: string[];
  simulation: RaceSimulation;
};

export type StoredRaceResult = {
  runId: string;
  title: string;
  resultMode: ResultMode;
  raceSeed: string;
  layoutSeed: string;
  createdAt: string;
  winnerNames: string[];
  winnerName?: string;
  rankedNames: string[];
};
