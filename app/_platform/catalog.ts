import type { GameCatalogEntry } from "./contracts";

export const GAME_CATALOG = [
  {
    id: "roulette",
    label: "Roulette",
    slug: "roulette",
    version: "1.3.3",
    capabilities: {
      grouping: false,
      configurableWinnerCount: true,
      replay: true,
      maxParticipantsPerRun: null,
    },
  },
  {
    id: "showdown",
    label: "Showdown",
    slug: "showdown",
    version: "1.3.3",
    capabilities: {
      grouping: "optional",
      configurableWinnerCount: true,
      replay: true,
      maxParticipantsPerRun: 10,
    },
  },
] as const satisfies readonly GameCatalogEntry[];

export type GameId = (typeof GAME_CATALOG)[number]["id"];

// Preserve the standalone marble game's first-visit behavior. Returning users
// resume the last game saved by the common shell.
export const DEFAULT_GAME_ID: GameId = "showdown";

export function isGameId(value: unknown): value is GameId {
  return GAME_CATALOG.some((game) => game.id === value);
}

export function gameCatalogEntry(gameId: GameId) {
  return GAME_CATALOG.find((game) => game.id === gameId)!;
}
