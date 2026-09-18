# Training Review

An internal web app for reviewing and commenting on SCORM training modules.
Upload a SCORM zip, browse the list of modules on the left, preview the
module in the middle, and leave threaded, resolvable comments tied to the
exact module and section on the right.

## Features

- **Google sign-in**, restricted to your company's Workspace domain.
- **Upload SCORM zips.** The server extracts the package, reads
  `imsmanifest.xml` for the title and launch file, and falls back to
  scanning for a plausible `index.html` if the manifest is missing or
  nonstandard.
- **In-browser SCORM playback.** The module runs in an iframe against a
  built-in SCORM 1.2 / SCORM 2004 "LMS API" shim, so content that calls
  `LMSSetValue`, `LMSCommit`, etc. runs the way it would in a real LMS.
- **Auto-tagged comments.** As the reviewer moves through the module, the
  shim captures the page/slide location the content itself reports
  (`cmi.core.lesson_location` / `cmi.location`) and pre-fills new comments
  with it. Reviewers can edit that value before posting if the content
  doesn't report a location.
- **Threaded, resolvable comments.** Every comment has a *Reply* button
  (nested replies) and a *Mark resolved* / *Reopen* toggle. A per-module
  "unresolved only" filter helps track open feedback.

## Quick start

This app has **zero npm dependencies** -- it's built entirely on Node's
standard library, so there's no `npm install` step and nothing to compile.
You need Node.js 18 or later.

```bash
cp .env.example .env
# edit .env -- see "Setting up Google Sign-In" below
node server/index.js
```

Then open the URL printed in the terminal (`http://localhost:3000` by
default).

### Trying it without Google OAuth first

If you just want to click around before setting up Google sign-in, leave
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` blank in `.env`. The app
automatically enables a **dev sign-in** box on the login screen that lets
you sign in as any email/name, no Google credentials required. It's clearly
separate from the real Google button and is meant for local testing only --
set `ALLOW_DEV_LOGIN=false` once you deploy for real (it also turns itself
off automatically as soon as you fill in real Google credentials, unless
you explicitly force it on).

## Setting up Google Sign-In

1. Go to the [Google Cloud Console](https://console.cloud.google.com/),
   create (or pick) a project for this app.
2. **APIs & Services -> OAuth consent screen.** Choose **Internal** if this
   is only for your Google Workspace organization (recommended -- it
   restricts sign-in to your org at the Google level, in addition to the
   `GOOGLE_ALLOWED_DOMAIN` check this app also does). Fill in the app name
   and support email.
3. **APIs & Services -> Credentials -> Create Credentials -> OAuth client
   ID.** Application type: **Web application**.
4. Under **Authorized redirect URIs**, add:
   `https://your-domain.example.com/auth/google/callback`
   (or `http://localhost:3000/auth/google/callback` for local testing --
   this must exactly match `BASE_URL` in your `.env` plus `/auth/google/callback`).
5. Copy the generated **Client ID** and **Client Secret** into `.env` as
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
6. Set `GOOGLE_ALLOWED_DOMAIN` to your company's domain (e.g. `acme.com`).
   Sign-ins from any other domain are rejected, even if the person has a
   valid Google account.
7. Restart the app.

## Deploying it for real

- Run it behind a reverse proxy (nginx, Caddy, your cloud load balancer)
  that terminates HTTPS, and set `SECURE_COOKIES=true` once it's served
  over HTTPS.
- Keep the process alive with a process manager (`systemd`, `pm2`, your
  platform's equivalent) -- e.g. `ExecStart=/usr/bin/node server/index.js`
  in a systemd unit, with `Restart=always`.
- `BASE_URL` must be the exact public URL people will use, matching the
  redirect URI you registered with Google.
- Back up the `data/` directory (it holds `db.json`, the whole app's
  state) and `uploads/` (the extracted SCORM packages) -- see "How data is
  stored" below.

## How data is stored

To keep this a zero-dependency, install-and-run app, state lives in flat
files instead of a database server:

- `data/db.json` -- users, modules, and comments.
- `data/sessions.json` -- login sessions (so people stay signed in across
  restarts).
- `uploads/<module-id>/...` -- each SCORM package's extracted files.

This is genuinely fine for a small-to-medium internal team. All of the
storage logic is isolated in `server/lib/db.js` and `server/lib/session.js`
-- if you outgrow flat files, those are the only two files you'd need to
rewrite against a real database; nothing else in the app touches the
filesystem for data.

Note: because sessions and the module/comment store are both in-process,
this app is meant to run as a **single Node process**. Running multiple
instances behind a load balancer without a shared store would cause
inconsistent sessions/data between them.

## How SCORM playback and section-tracking work

SCORM content expects to find a JavaScript object called `API` (SCORM 1.2)
or `API_1484_11` (SCORM 2004) somewhere up its window/frame hierarchy, and
calls methods like `LMSSetValue("cmi.core.lesson_location", "slide-4")` to
report the learner's bookmark/location as they move through the material.

This app's frontend (`public/scorm-api.js`) implements a small, permissive
version of that API and installs it on the top-level page. Since the
module plays in a same-origin iframe nested directly inside that page, the
content's own "find the API" logic locates it without any extra wiring.
Whenever the content reports a location, the app updates the "Current
section" badge above the viewer and pre-fills the comment composer with
it -- that's the "auto-detected page/slide" behavior. It's a "good enough
LMS," not a certified one: it accepts whatever the content reports rather
than enforcing real sequencing/grading rules.

**Multi-SCO packages:** if a package's manifest defines more than one
launchable item, a dropdown appears above the viewer to switch between
them. Each item is treated as an independent launch; there's no full
SCORM sequencing engine (prerequisites, rollup rules, etc.) -- for review
purposes that's rarely needed, since most authoring tools (Articulate,
Captivate, Rise, iSpring...) publish a single SCO that manages its own
internal pages/slides.

## Project layout

```
server/
  index.js            HTTP server + route wiring (plain Node http, no Express)
  config.js            Reads .env / environment variables
  routes/
    auth.js             Google OAuth flow, dev login, /api/me
    modules.js           Upload/list/get/delete modules, serve extracted content
    comments.js           Comment CRUD, resolve toggling
  lib/
    db.js                 Flat-file data store (users/modules/comments)
    session.js             Cookie session store
    googleAuth.js            Google OAuth against Google's HTTPS endpoints
    zip.js                    Minimal zip reader/extractor (stored + deflate)
    xml.js                     Minimal XML parser (for imsmanifest.xml)
    scormManifest.js             Manifest -> title/launch file/items
    multipart.js                  multipart/form-data parser (for uploads)
    router.js                      Tiny path-based router
    staticFile.js                   Static file serving with Range support
    http-helpers.js                  JSON body/response helpers
    cookies.js                        Cookie parsing/serialization
    authGuard.js                       requireAuth() helper
    loadEnv.js                          .env file loader
public/
  index.html            The single-page frontend
  styles.css             Layout/visual styling
  app.js                   All frontend logic (fetch calls, rendering, events)
  scorm-api.js              The browser-side SCORM API shim
```

## Why no npm dependencies?

This was a deliberate choice, not just a workaround: an internal tool like
this benefits from having nothing to `npm install`, no native modules to
compile on whatever server it lands on, and a much smaller supply-chain
surface. Everything it needs -- an HTTP server, session cookies, a zip
reader, an XML parser, a multipart form parser, and an OAuth client -- is
implemented directly against Node's built-in `http`/`https`/`zlib`/`crypto`
modules in `server/lib/`. If your team would rather build on Express,
Passport, `adm-zip`, etc. instead, the code is organized so that's a
straightforward swap -- each concern lives in its own small file.

## Known limitations

- No admin/roles model yet -- any signed-in user can upload, comment,
  resolve, and delete modules. Add a role check in the relevant route
  handlers if you need to restrict uploads/deletes to specific people.
- Comment editing isn't implemented (only posting, replying, and
  resolving). There's a `DELETE /api/comments/:id` endpoint for a comment's
  own author, but no delete button in the UI yet -- add one in
  `public/app.js` / `public/index.html` if you want it surfaced.
- No email/Slack notifications when someone comments or resolves.
- Zip extraction supports the two compression methods every SCORM
  packaging tool actually uses (stored and deflate); the rare zip using
  something else (bzip2, LZMA) will be rejected with a clear error.
