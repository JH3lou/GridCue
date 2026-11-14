import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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

    it("says where the plan differs from the request's words", async () => {
      const { user, input } = setup();
      await user.type(input, "exclude value over $100{Enter}");
      expect(await screen.findByText("Filter Value at or below $100")).toBeTruthy();
      expect(screen.getByText("Rows with no Value are hidden too.")).toBeTruthy();
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

    // ADR 0027: after a count, a change to the sort asks, and each answer previews its own line.
    describe("a count's question", () => {
      const countedSetup = () => {
        const adapter = createRowsAdapter({ schema });
        adapter.setState((v) => ({ ...v, sorts: [{ columnId: "value", direction: "desc" }], limit: 10 }));
        const controller = createGridCue({ adapter, provider: createMockProvider() });
        render(renderBar(controller));
        return { adapter, user: userEvent.setup(), input: screen.getByRole("textbox", { name: /describe the view/i }) };
      };
      const question = "Keep only the first 10 rows of the new view, or show every row?";

      it("shows its two choices and no Preview", async () => {
        const { user, input } = countedSetup();
        await user.type(input, "sort by name{Enter}");
        const group = await screen.findByRole("group", { name: question });
        expect(
          within(group)
            .getAllByRole("button")
            .map((b) => b.textContent),
        ).toEqual(["Keep the first 10", "Show every row"]);
        expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
      });

      it("previews the count line when the User keeps it", async () => {
        const { user, input } = countedSetup();
        await user.type(input, "sort by name{Enter}");
        await user.click(await screen.findByRole("button", { name: "Keep the first 10" }));
        expect(await screen.findByText("Sort by Name, ascending")).toBeTruthy();
        expect(screen.getByText("Show only the first 10 rows")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
      });

      it("previews the clear line when the User shows every row", async () => {
        const { adapter, user, input } = countedSetup();
        await user.type(input, "sort by name{Enter}");
        await user.click(await screen.findByRole("button", { name: "Show every row" }));
        expect(await screen.findByText("Sort by Name, ascending")).toBeTruthy();
        expect(screen.getByText("Show every row")).toBeTruthy();
        await user.click(screen.getByRole("button", { name: "Apply" }));
        await waitFor(() => expect(adapter.getState().state.limit).toBeUndefined());
      });

      it("clears a count in one request, with its own line", async () => {
        const { user, input } = countedSetup();
        await user.type(input, "show every row{Enter}");
        expect(await screen.findByText("Show every row")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
      });
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
