# CLAUDE.md — materialious (bix fork)

Our fork of [Materialious](https://github.com/wardpearce/Materialious)
(AGPL-3.0), based on upstream **1.18.10**. It's built two ways from this one
tree:

- **Web server** — `watch` in bix-infra's compose builds `materialious/`
  with upstream's `FullDockerfile`; it serves watch.bix.computer behind
  `watch-proxy`.
- **Android TV app** — `bix/build-apk.sh` → `computer.bix.materialious`,
  installed on the Shield over adb.

Both must stay on the same upstream version, and the server must never move
back a version (its database may have migrated).

## Commands

```bash
# Web server (from bix-infra) — about 10 s of downtime
cd /home/matt/apps/bix-infra && docker compose build watch && docker compose up -d watch

# TV app
bix/build-apk.sh                          # → bix/out/materialious.apk (Docker; ~4 min)
adb connect 192.168.0.36:5555             # the Shield (Developer options → Network debugging)
adb -s 192.168.0.36:5555 install -r bix/out/materialious.apk   # restarts the app if open

# Type check / lint (upstream has no tests): run in the deps stage
docker build -f bix/android.Dockerfile --target deps -t materialious-deps materialious
# then copy the tree into a container from it with /src/node_modules and
# /src/shared/node_modules, and run `npm run check` (baseline: 0 errors,
# 59 warnings) and `npx eslint <changed files>`; `npx prettier --write` too.
```

The APK is `computer.bix.materialious` (upstream is `us.materialio.app`), so
it never collides with upstream's app. It's signed with the key in
`~/.config/bix/watch-tv-apk/` (named after the retired watch_tv app); losing
that key means uninstalling first, which wipes the TV's sign-in and local
feed. Android has no self-updater (it's Electron-only), so nothing offers
upstream's APK. `watch` has no `deploy` entry in bix-infra's `services.toml`
yet, so the nightly restart doesn't rebuild it: deploy by hand as above.

## Git

**Remotes**

| Remote | URL | Use |
|--------|-----|-----|
| `origin` | `git@github.com:matt-t-needham/watch.git` | ours; fetch and push here |
| `upstream` | `https://github.com/wardpearce/Materialious.git` | mainline; fetch only (push URL set to `DISABLED-do-not-push-to-upstream`) |

**Branches**

- `main` — the only working branch, tracking `origin/main`. It starts at one
  squashed commit, "Initial commit - forked from mainline" (upstream 1.18.10
  plus our patches at that point), so it shares **no history** with
  upstream: you can't rebase or merge upstream into it directly.
- `bix` — local only, for reference: the first six patches as separate
  commits on upstream's `1.18.10` tag. Not updated since; `main` has more.
- `bix-on-1.18.7` — local only: the same six patches on 1.18.7, from before
  the move to 1.18.10.

**Everyday changes**

1. Edit on `main`; mark our code with `bix:` comments.
2. Type check, lint and prettier (Commands above).
3. Build and deploy whichever outputs the change touches: the web server
   (`src/` that runs in the browser or `hooks.server.ts`/`routes/api`), the
   APK (anything that reaches the TV, including `android/` and
   `static/nodejsAndroid/`), usually both.
4. Add a line to **Patches** below for anything new.
5. Commit (short, plain messages; the user commits or asks Claude to) and
   `git push`.

**Taking a new upstream release**

`main` has no upstream history, so upstream's changes go in as a patch:

```bash
git fetch upstream --tags
OLD=1.18.10 NEW=<new tag>                       # OLD = the version this file names
git diff $OLD $NEW > /tmp/upstream-$NEW.patch
git apply -3 /tmp/upstream-$NEW.patch           # 3-way; stages what applies, conflicts get markers
git status                                      # fix every conflict; grep for <<<<<<<
grep -rn "bix:" materialious/src materialious/android materialious/static | wc -l   # our changes still there?
```

Tried 2026-10-24 by applying 1.18.7 → 1.18.10 onto the 1.18.7 patches: clean,
and our `applicationId` survived beside upstream's new version lines.
Then check with **Patches** below that each change survived, run the type
check, build and install the APK, deploy the web server, update "based on
upstream" at the top of this file and in bix-infra's `CLAUDE.md`, and commit
as `Upstream $NEW`. Read upstream's release notes first: a new database
migration means the server can't go back afterwards. Upstream's
`android/app/build.gradle` version lines sit next to our `applicationId`
and may conflict.

**Offering a change back upstream** (optional)

Our commits on `main` are ordinary diffs, so they cherry-pick onto upstream:

```bash
git switch -c upstream-pr upstream/main
git cherry-pick <commit>                        # resolve, drop bix-only bits
```

Push that branch to a GitHub fork of upstream and open a PR from there
(never to `upstream` from here). Generic fixes are the candidates (the
proxy sign-in fix, the TV panel D-pad); `bix:`-specific ones (package ID,
Watch on TV's room, our user agent) aren't.

**Upstream's GitHub workflows** (`.github/workflows/`) came with the fork.
They run on pull requests to `main` or by hand, never on push, and would fail
here without upstream's signing and publishing secrets.

## Patches

Everything we've changed from upstream, so a new upstream release can be
checked against it. Mark our code with `bix:` comments (search `bix:` to
find every change).

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
- **Web sign-in doesn't depend on the cookie** — Materialious's session
  cookie (`Path=/api`, 60 days) lapses while the page's token keeps working,
  so the server's proxy (and `/api/poToken`) answered 401: no videos, no
  feed. `src/lib/fetchProxy.ts` sends the token as `X-Bix-Auth` on proxied
  requests (also into headers passed alongside a Request, which replace the
  Request's own — youtubei.js does that); `src/hooks.server.ts` accepts it
  only under `/api/proxy/`; the proxy route strips it before forwarding (it
  forwards `Authorization`, so that header can't be used).
  `src/lib/web/youtube/minter.ts` uses `backendFetch` (Bearer) for PO tokens.
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
- watch-proxy (bix-infra `nginx/watch.conf`) masks personal data in its
  access log: IDs in page paths, query strings, history/quick-connect IDs,
  proxied URLs (host and YouTube API path only). Diagnosing from the log
  means working from request shapes, not which video or room.
- SponsorBlock does nothing until categories are chosen (upstream default:
  none). They sync per account (`sponsorBlockCategoriesv2`). "Manual" segments
  offer Skip in a toast, which the D-pad may not reach — use "automatic" on TV.
