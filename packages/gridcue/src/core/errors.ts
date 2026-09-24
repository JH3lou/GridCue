export type ErrorStage = "INPUT" | "RESOLUTION" | "PLAN" | "POLICY" | "ADAPTER" | "PROVIDER";
export type GridCueErrorCode = `${ErrorStage}_${string}`;

/** A problem found while checking a request or plan. Messages are safe to show users. */
export interface Issue {
  code: GridCueErrorCode;
  message: string;
  path?: string;
}

export class GridCueError extends Error {
  readonly code: GridCueErrorCode;
  constructor(code: GridCueErrorCode, message: string) {
    super(message);
    this.name = "GridCueError";
    this.code = code;
  }
}

export const isGridCueError = (value: unknown): value is GridCueError => value instanceof GridCueError;
