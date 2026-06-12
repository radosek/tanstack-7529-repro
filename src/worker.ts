import { render } from "./entry-server";

// Minimal Worker fetch entry. `@cloudflare/vite-plugin` serves the built
// client assets (ASSETS binding) and routes document requests here, running
// SSR inside workerd — the runtime where the #7529 hang surfaces. A plain
// Node SSR server does NOT reproduce it; the workerd stream chunk timing does.
export default {
	async fetch(request: Request, env: { ASSETS: { fetch: typeof fetch } }): Promise<Response> {
		const url = new URL(request.url);

		// Static assets (JS/CSS/etc.) come from the client build.
		if (url.pathname.startsWith("/assets/") || url.pathname.includes(".")) {
			return env.ASSETS.fetch(request);
		}

		return render({ request });
	},
};
