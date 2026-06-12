# TanStack Router #7529 — SSR stream never closes on router-core 1.171.x

Minimal, deterministic reproduction for
[TanStack/router#7529](https://github.com/TanStack/router/issues/7529)
(fix proposed in [#7591](https://github.com/TanStack/router/pull/7591)).

**Same application code. Only the router version changes:**

| `@tanstack/react-router` | `@tanstack/router-core` | Result |
| --- | --- | --- |
| `1.169.0` | `1.169.0` | ✅ response completes in ~3 ms, full `</body></html>` + TSR end marker |
| `1.170.15` (latest) | `1.171.13` (latest) | ❌ **hangs on every request** — shell + dehydration bytes arrive, closing tags never do; browser spins until router-core's 60 s serialization timeout |

`@tanstack/react-router-ssr-query` is `1.167.1` (latest) in both cases.

## Run it

```sh
bun install
bun run build
bun run preview        # wrangler dev (workerd) on http://localhost:8787
```

Open the page in a browser → the tab loads HTML but **never finishes**
(spinner forever, no hydration — the router's module scripts are withheld
with the closing tags).

Or prove it with curl:

```sh
curl -s -m 15 http://localhost:8787/ -o /tmp/out.html \
  -w "bytes=%{size_download} time=%{time_total}s\n"
tail -c 120 /tmp/out.html       # no </html>, body cut after the dehydration script
```

Flip to the working version and repeat — same code, instant completion:

```sh
bun run use:good   # pins @tanstack/react-router@1.169.0
bun run build && bun run preview
curl -s -m 15 http://localhost:8787/ -w "time=%{time_total}s\n" | tail -c 120
# … $_TSR.e(); …</body></html>   time=0.003s
```

`bun run use:bad` returns to `1.170.15`.

The app also deploys as-is to Cloudflare Workers (`bun run deploy`) — the
behaviour is identical there; this is where we first hit it in production.

## What the app does

- `src/router.tsx` — `createRouter` + `setupRouterSsrQueryIntegration({ router, queryClient })`
- `src/routes/index.tsx` — one route, one query resolved via `ensureQueryData` in the loader
- `src/entry-server.tsx` — `createRequestHandler` → `renderToReadableStream` →
  `transformReadableStreamWithRouter` → `new Response(stream)`

The entry-server is the body of `@tanstack/react-router@1.169.0`'s **own
`renderRouterToStream`** (the `renderToReadableStream` branch), inlined
verbatim:

```js
// packages/react-router/src/ssr/renderRouterToStream.tsx @ v1.169.0
const responseStream = transformReadableStreamWithRouter(router, stream)
return new Response(responseStream, {
  status: router.stores.statusCode.get(),
  headers: responseHeaders,
})
```

It compiles and runs cleanly against `1.170.x` — it just never closes the
response.

## Mechanism (instrumented trace, router-core 1.171.13)

Logging added to `ssr-server.ts` and `router-ssr-query-core` shows this
sequence on every hanging request:

```
1. onRenderFinished   registered OK (listeners=1)        ← ssr-query's close listener, during dehydrate()
2. reserveStreamFastPath  returns false                   ← transform takes the main stream path
3. cleanup()          wipes renderFinishedListeners=1,    ← createRequestHandler's `finally`,
                      serializationFinishedListeners=1       while the body is STILL STREAMING
4. ssr-query teardown closes the query stream             ← via onCleanup
5. setRenderFinished  finds listeners=0                   ← app stream ends; close listener is gone,
                                                             completion signals destroyed
```

The cause is step 3. `createRequestHandler` changed semantics between the
two versions:

```js
// v1.169.0 — once the callback is invoked, the handler NEVER cleans up;
// the stream transform owns the lifecycle. Any callback return is safe.
cbWillCleanup = true;
return cb({ request, router, responseHeaders });
} finally {
    if (!cbWillCleanup) router.serverSsr?.cleanup();
}
```

```js
// v1.171.x — cleanup is deferred ONLY if the callback's return value is
// wrapped by createSsrStreamResponse (serverSsrCleanup === "stream").
// A plain Response → cleanup() fires while the body is still streaming.
const ssrResponse = normalizeSsrResponse(await cb({ ... }));
responseOwnsCleanup = ssrResponse.serverSsrCleanup === "stream";
return ssrResponse.response;
} finally {
    if (!responseOwnsCleanup) router.serverSsr?.cleanup();
}
```

`cleanup()` clears `renderFinishedListeners` and
`serializationFinishedListeners` and detaches `router.serverSsr`. The
in-flight stream transform is left waiting for completion signals whose
listeners no longer exist, so it never emits the closing
`</body></html>` / router module scripts, and the response hangs until
router-core's 60 s serialization timeout.

Returning a plain `Response` was the contract in `1.169.0` — it is exactly
what `1.169.0`'s own `renderRouterToStream` returned. The wrapper that makes
`1.171.x` defer cleanup, `createSsrStreamResponse`, **does not exist in
`1.169.0`**, so there was no migration path when the behaviour changed;
existing integrations started hanging silently on upgrade.
(`renderRouterToStream` in `1.171.x` wraps internally, which is why the
built-in handler is unaffected.)

Note for [#7591](https://github.com/TanStack/router/pull/7591): in this
trace the ssr-query listener is **not** refused at registration (step 1
succeeds — the `streamFastPathReserved` arm never fires). It is registered
and then wiped by the premature `cleanup()`. A fix limited to the
registration guard does not resolve this reproduction.

## Production impact (how we found it)

A production Cloudflare Workers site with `@tanstack/react-router` set to
`latest` picked up `1.170.x` while `@tanstack/react-router-ssr-query` was at
its latest (`1.167.1`). Every SSR request started hanging to the
`Serialization timeout after app render finished` error: browsers spun for
60 s and never hydrated; the CDN refused to cache the aborted streams, so
every cold visitor repeated the hang site-wide. Pinning back to `1.169.0`
(code unchanged) resolved it immediately, which is what this repro
demonstrates.
