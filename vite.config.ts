import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	appType: "custom",
	plugins: [
		cloudflare(),
		tanstackRouter({ target: "react", autoCodeSplitting: false }),
		react(),
	],
});
