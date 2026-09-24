// @vitest-environment jsdom
import { GridCueBar } from "../src/react";
import { runCommandBarSuite } from "./command-bar-suite";

runCommandBarSuite("GridCueBar", (controller) => <GridCueBar controller={controller} />);
