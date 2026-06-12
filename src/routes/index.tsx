import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

// A query that resolves IMMEDIATELY (no awaited I/O). This is the issue's
// "routes that resolve all queries quickly" case: serialization finishes
// before the transform attaches, so `reserveStreamFastPath()` can fire — and
// on router-core 1.171.x it then drops the ssr-query close listener (#7529).
const fastQuery = queryOptions({
	queryKey: ["fast"],
	queryFn: () => ({ title: "Resolved instantly on the server." }),
});

export const Route = createFileRoute("/")({
	loader: ({ context }) => context.queryClient.ensureQueryData(fastQuery),
	component: Home,
});

function Home() {
	const { data } = useSuspenseQuery(fastQuery);
	return (
		<main style={{ fontFamily: "system-ui", padding: "3rem", maxWidth: 640 }}>
			<h1>TanStack Router #7529</h1>
			<p>
				If you can read this and the tab is <strong>not</strong> stuck on a
				spinner, SSR streaming finished correctly.
			</p>
			<pre style={{ background: "#f4f4f5", padding: "1rem", borderRadius: 8 }}>
				{data.title}
			</pre>
		</main>
	);
}
