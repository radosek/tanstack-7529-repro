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

## Mechanism (traced against router-core 1.171.13)

1. `createRequestHandler` ([`createRequestHandler.js`](https://github.com/TanStack/router/blob/main/packages/router-core/src/ssr/createRequestHandler.ts))
   normalizes the callback's return value:
   a plain `Response` gets `serverSsrCleanup: "none"`, so the handler's
   `finally` block calls `router.serverSsr.cleanup()` **as soon as the
   callback returns — while the response body is still streaming.**
2. `cleanup()` sets `cleanupStarted = true` and clears
   `renderFinishedListeners` (`ssr-server.ts`).
3. From that point the guard in `onRenderFinished`
   (`ssr-server.ts`, the line PR #7591 touches):

   ```js
   onRenderFinished: (listener) => {
       if (cleanupStarted || streamFastPathReserved) return; // silently dropped
       renderFinishedListeners.push(listener);
   },
   ```

   drops every listener — including the one
   `@tanstack/router-ssr-query-core` relies on to close its dehydration
   query stream.
4. The query stream never closes → serialization never finishes → the
   stream transform withholds the closing `</body></html>` and the
   router-injected module scripts → the response hangs until the 60 s
   serialization timeout. The browser shows an infinite spinner and the
   page never hydrates.

The only way to avoid the premature `cleanup()` on `1.170.x` is to wrap the
response in `createSsrStreamResponse(router, response)` — **an API that did
not exist in `1.169.0`**, so there was no migration path to it when the
behaviour changed; existing integrations started hanging silently on
upgrade. (`renderRouterToStream` does this wrapping internally, which is why
the built-in handler is unaffected.)

`#7529`'s `streamFastPathReserved` arm and this `cleanupStarted` arm are the
same guard line with the same end state: a silently-dropped
`onRenderFinished` listener and a response that never closes. Both were
introduced by the same streaming rework (#7497).

## Production impact (how we found it)

A production Cloudflare Workers site with `@tanstack/react-router` set to
`latest` picked up `1.170.x` while `@tanstack/react-router-ssr-query` was at
its latest (`1.167.1`). Every SSR request started hanging to the
`Serialization timeout after app render finished` error: browsers spun for
60 s and never hydrated; the CDN refused to cache the aborted streams, so
every cold visitor repeated the hang site-wide. Pinning back to `1.169.0`
(code unchanged) resolved it immediately, which is what this repro
demonstrates.
