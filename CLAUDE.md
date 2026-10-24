# CLAUDE.md — materialious (bix fork)

Our fork of [Materialious](https://github.com/wardpearce/Materialious)
(AGPL-3.0), on upstream `1.18.10`. Our repo is
`git@github.com:matt-t-needham/watch.git` (remote `origin`, branch `main`),
which starts from one squashed commit ("Initial commit - forked from
mainline"), so it carries no upstream history. Remote `upstream` and the
local branches `bix` (our patches as separate commits on the 1.18.10 tag)
and `bix-on-1.18.7` are kept for reference; `main` is where work goes now. Built two ways: our own
Android TV APK (`bix/build-apk.sh`), and the web server — `watch` in
bix-infra's compose builds `materialious/` with upstream's `FullDockerfile`
(`docker compose build watch && docker compose up -d watch` from bix-infra).
Both must stay on the same upstream version: never move the server back a
version (its database may have migrated).

## Commands

```bash
bix/build-apk.sh                          # → bix/out/materialious.apk (Docker; ~2 min warm)
adb connect 192.168.0.36:5555             # the Shield
adb -s 192.168.0.36:5555 install -r bix/out/materialious.apk

# Type check / lint (upstream has no tests): run in the deps stage
docker build -f bix/android.Dockerfile --target deps -t materialious-deps materialious
# then copy the tree into the container with node_modules and run
# `npm run check` (upstream: 0 errors) and `npx eslint <changed files>`
```

The APK is `computer.bix.materialious` (upstream is `us.materialio.app`), so
it never collides with upstream's app. It's signed with the key in
`~/.config/bix/watch-tv-apk/` (named after the retired watch_tv app); losing that key means uninstalling first, which
wipes the TV's sign-in and local feed. Android has no self-updater (it's
Electron-only), so nothing offers upstream's APK.

## Patches (`git log upstream..bix` once committed)

Mark our code with `bix:` comments so a rebase shows what's ours.

- **Package ID** — `android/app/build.gradle` `applicationId`.
- **Feed: durations, no Shorts** — `src/lib/api/youtubejs/subscriptions.ts`.
  RSS still finds new videos (exact times); entries linked `/shorts/` are
  dropped; for a channel whose RSS has something not yet stored, one Videos
  tab fetch (youtubei.js) gives durations, and RSS entries missing from it or
  with no length (streams, premieres) are skipped and retried next refresh.
  Rows the plain-RSS engine stored (length 0) are hidden and refetched.
  A failed channel throws instead of being swallowed.
- **Refresh button** — `src/routes/(app)/subscriptions/+page.svelte`:
  ignores the cooldown, waits for every channel, names the ones that failed,
  reloads the list. Opening the page also reloads it when the background
  refresh adds anything (upstream showed new videos one visit late).
  Strings in `src/lib/i18n/locales/en.json` (`subscriptions.*`).
- **TV player settings** — `src/lib/components/player/settings/TvPlaybackSettings.svelte`,
  shown at the top of the TV player's Down panel (`src/routes/(no-layout)/tv/[slug]/+page.svelte`):
  quality, speed, Match frame rate, and a stats line (resolution, fps,
  display Hz, dropped frames). `Player.svelte` hands its shaka player over
  through `onShakaPlayer`.
- **Refresh-rate matching** — native `android/.../DisplayMode.java` (registered
  in `MainActivity.java`), wrapped by `src/lib/android/plugins/displayMode.ts`.
  The TV page asks for a mode at the current resolution whose rate is an exact
  multiple of the track's fps (prefer the current mode, then the highest),
  and resets on leaving. YouTube reports whole-number fps, so 23.976 content
  gets 24 Hz. Setting `bixMatchFrameRate` in `src/lib/stores/player.ts`.
- **D-pad in the TV panel** — same page: Up/Down go to the nearest row,
  Left/Right along the row (upstream walked a flat list).
- **App user agent** — `static/nodejsAndroid/index.js` (the in-app proxy
  every request goes through): YouTube/Google hosts still get upstream's
  desktop-Mac UA; everything else, our server included, gets
  `Materialious-bix (Android)`, so watch-proxy's log can tell the app apart.
- **Watch on TV** — `src/lib/watchOnTv.ts`. The watch page (phone/web, not
  TV) has a "Watch on TV" button that POSTs a `goToVideo` (video + time) to
  the watch-party relay at `/api/watchParty/<room>`; the TV app, while open
  and signed in, listens there (started in `src/routes/+layout.svelte`) and
  opens `/tv/<id>?time=<s>`. Room: 32 hex chars in the synced, device-
  encrypted setting `bixTvRoom` (registered in
  `src/lib/externalSettings/settings.ts`, because the server only accepts
  known setting names); only the TV creates it. The stream is read with
  fetch, not EventSource, so on Android it goes through the in-app proxy
  (CORS). The relay replays its last event to new listeners, freshly
  stamped: each send adds a sub-millisecond random offset to the time and
  the TV remembers the last one it handled (localStorage `bixTvLastHandled`).
  The relay has no login (upstream); the room name is the secret, and it
  travels in an `X-Bix-Room` header to `/api/watchParty/bix-tv` (resolved in
  `src/routes/api/watchParty/[roomId]/+server.ts`, allowed by the in-app
  proxy's CORS list), so it never appears in a URL or a log.
  Also in each video tile's three-dots menu (`VideoThumbnail.svelte`),
  which sends time 0: under a second the TV opens `/tv/<id>` with no
  `?time`, so the player resumes from watch history instead of restarting.
  Both use `sendToTvAndReport` (toast on success or failure).
- **Back closes the TV panel** — `src/lib/backHandlers.ts`, consulted first by
  the `backButton` listener in `src/routes/+layout.svelte`.

## Gotchas

- TV mode (`isAndroidTv()`, via the `AndroidTv` Capacitor plugin) only
  switches on inside the APK. The same pages in a browser or WebView get the
  desktop layout, which is unusable with a D-pad.
- On Android, YouTube requests go to a Node server inside the app, so the TV
  fetches from its own IP — the home IP the Rage pipeline also uses.
- First run: answer "No" to Invidious, then Settings → Interface →
  Materialious URL `https://watch.bix.computer`, then Login → quick connect
  (code from Settings → Account → Quick connect on a signed-in device).
- SponsorBlock does nothing until categories are chosen (upstream default:
  none). They sync per account (`sponsorBlockCategoriesv2`). "Manual" segments
  offer Skip in a toast, which the D-pad may not reach — use "automatic" on TV.
- Taking a new upstream release: `main` has no upstream history to rebase,
  so apply upstream's changes as a patch:
  `git fetch upstream tag <new> && git diff 1.18.10 <new> | git apply -3`,
  resolve conflicts, rebuild both outputs, recheck `npm run check`, and
  update the version noted above. Never move the server back a version.
