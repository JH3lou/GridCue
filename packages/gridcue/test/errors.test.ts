import { describe, expect, it } from "vitest";
import { GridCueError, isGridCueError } from "../src/index";

describe("GridCueError", () => {
  it("carries a stable, stage-prefixed code and a safe message", () => {
    const error = new GridCueError("PLAN_STALE_REVISION", "The view changed since this plan was made.");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("GridCueError");
    expect(error.code).toBe("PLAN_STALE_REVISION");
    expect(isGridCueError(error)).toBe(true);
    expect(isGridCueError(new Error("plain"))).toBe(false);
  });
});
