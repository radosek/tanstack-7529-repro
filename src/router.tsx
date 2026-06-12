import { QueryClient } from "@tanstack/react-query";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { createRouter as createTanstackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// Router options match a production streaming-SSR + ssr-query setup:
// `defaultPreload: "intent"`, `defaultPreloadStaleTime: 0`, `trailingSlash`,
// then `setupRouterSsrQueryIntegration`. Nothing here is exotic — this is the
// documented integration wiring.
export function createRouter() {
	const queryClient = new QueryClient();

	const router = createTanstackRouter({
		routeTree,
		context: { queryClient },
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		trailingSlash: "never",
		scrollRestoration: true,
	});

	setupRouterSsrQueryIntegration({ router, queryClient });

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof createRouter>;
	}
}
