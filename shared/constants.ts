// Tunables shared by the client and the server.

export const MAX_PLAYERS = 8;

/**
 * Page pixels (CSS px) per world pixel. Liero was made for a 320x200 screen; at 1:1 a modern
 * window is a huge arena with tiny, slow-looking worms. 2 gives Liero's proportions and pace.
 */
export const PAGE_PX = 2;

// World capture limits (world pixels)
export const MAX_WORLD_W = 1200;
export const MAX_WORLD_H = 1600;

export const PLAYER_COLORS = [
  '#ff5a5f', '#3ec1ff', '#ffd23f', '#7cff6b', '#c77dff', '#ff9f43', '#00e5c0', '#ff6bd6',
];
