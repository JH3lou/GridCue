import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createGridCue } from "../src/core/controller";
import { createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import type { GridCueController } from "../src/index";
import { createMockProvider } from "../src/mock";

const schema = defineSchema([{ id: "name" }, { id: "value", kind: "currency" }, { id: "gain", kind: "currency" }]);

/** Every GridCue command bar, built-in or from the registry, must pass this suite. */
export const runCommandBarSuite = (name: string, renderBar: (controller: GridCueController) => ReactElement) => {
  describe(`${name}: command bar`, () => {
    afterEach(cleanup);
    const setup = () => {
      const adapter = createRowsAdapter({ schema });
      const controller = createGridCue({ adapter, provider: createMockProvider() });
      render(renderBar(controller));
      return { adapter, user: userEvent.setup(), input: screen.getByRole("textbox", { name: /describe the view/i }) };
    };

    it("previews on Enter, applies, and undoes with the keyboard", async () => {
      const { adapter, user, input } = setup();
      await user.type(input, "sort by value largest first{Enter}");
      expect(await screen.findByText("Sort by Value, descending")).toBeTruthy();
      expect(screen.getByRole("status").textContent).toContain("Ready to apply");
      await user.click(screen.getByRole("button", { name: "Apply" }));
      await waitFor(() => expect(adapter.getState().state.sorts).toHaveLength(1));
      expect(screen.getByRole("status").textContent).toContain("View updated.");
      await user.click(screen.getByRole("button", { name: "Undo" }));
      await waitFor(() => expect(adapter.getState().state.sorts).toHaveLength(0));
    });

    it("applies a ready preview with Ctrl+Enter without leaving the input", async () => {
      const { adapter, user, input } = setup();
      await user.type(input, "sort by value{Enter}");
      const apply = await screen.findByRole("button", { name: "Apply" });
      expect(apply.getAttribute("aria-keyshortcuts")).toBe("Control+Enter Meta+Enter");
      await user.type(input, "{Control>}{Enter}{/Control}");
      await waitFor(() => expect(adapter.getState().state.sorts).toHaveLength(1));
      expect(document.activeElement).toBe(input);
    });

    it("ignores Ctrl+Enter when nothing is ready to apply", async () => {
      const { adapter, user, input } = setup();
      const before = adapter.getState();
      await user.type(input, "sort by value{Control>}{Enter}{/Control}");
      expect(adapter.getState()).toEqual(before);
    });

    it("cancels with Escape and changes nothing", async () => {
      const { adapter, user, input } = setup();
      const before = adapter.getState();
      await user.type(input, "sort by value{Enter}");
      await screen.findByRole("button", { name: "Apply" });
      await user.type(input, "{Escape}");
      expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
      expect(adapter.getState()).toEqual(before);
    });

    it("offers clarification choices as buttons", async () => {
      const { user, input } = setup();
      await user.type(input, "over $1m{Enter}");
      expect(await screen.findByRole("group", { name: "Which column should be above $1,000,000?" })).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Gain" }));
      expect(await screen.findByRole("button", { name: "Apply" })).toBeTruthy();
    });

    it("shows typed markup as text and never renders it", async () => {
      const { user, input } = setup();
      await user.type(input, '<img src=x onerror="alert(1)"> sort by value, then sell it{Enter}');
      await screen.findByText(/only changes how the table looks/);
      expect(document.querySelector("img")).toBeNull();
    });

    it("explains unsupported requests in words, not just colour", async () => {
      const { user, input } = setup();
      await user.type(input, "sort by value, then sell everything{Enter}");
      expect((await screen.findByRole("status")).textContent).toMatch(/Can't do that.*only changes how the table looks/);
      expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    });
  });
};
