import { CommandBar } from "@/components/gridcue/command-bar";
import { runCommandBarSuite } from "../../packages/gridcue/test/command-bar-suite";

runCommandBarSuite("Registry CommandBar", (controller) => <CommandBar controller={controller} />);
