import {
	createRequestHandler,
	RouterServer,
	transformReadableStreamWithRouter,
} from "@tanstack/react-router/ssr/server";
import { renderToReadableStream } from "react-dom/server";
import { createRouter } from "./router";

// This is the body of @tanstack/react-router 1.169.0's OWN
// `renderRouterToStream` (the `renderToReadableStream` branch), inlined:
//
//   const responseStream = transformReadableStreamWithRouter(router, stream)
//   return new Response(responseStream, { status, headers })
//
// On 1.169.0 it completes in milliseconds. On 1.170.x (router-core 1.171.x)
// the SAME code never emits the closing `</body></html>` or the router's end
// marker — the response hangs until router-core's 60s serialization timeout.
// See README for the mechanism.
export function render({ request }: { request: Request }): Promise<Response> {
	const handler = createRequestHandler({ request, createRouter });

	return handler(async ({ request: req, responseHeaders, router }) => {
		const ssrPath = new URL(req.url).pathname;

		const stream = await renderToReadableStream(<RouterServer router={router} />, {
			signal: req.signal,
			progressiveChunkSize: Number.POSITIVE_INFINITY,
			onError(err) {
				const e = err instanceof Error ? err : new Error(String(err));
				console.error(
					JSON.stringify({ event: "ssr_render_error", path: ssrPath, message: e.message }),
				);
			},
		});

		// The pattern that worked on react-router 1.169.0: pipe the React stream
		// through `transformReadableStreamWithRouter` and return it. On
		// router-core 1.171.x the same code never closes the stream.
		// biome-ignore lint/suspicious/noExplicitAny: cross-runtime stream type bridge
		const responseStream = transformReadableStreamWithRouter(router, stream as any);

		return new Response(responseStream as unknown as BodyInit, {
			status: router.stores.statusCode.get(),
			headers: responseHeaders,
		});
	});
}
