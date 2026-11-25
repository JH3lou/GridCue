import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// No Server Handler here: the Mock Provider runs in the browser, so this example needs no key and no server.
export default defineConfig({ plugins: [react()] });
