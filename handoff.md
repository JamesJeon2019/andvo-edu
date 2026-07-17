# Handoff — Andvo Edu

_Last updated: 2026-07-17_

## Project status

Andvo Edu is an AI-powered lesson generator for Swedish schools (Node.js +
Express backend, Claude API for content generation, plain HTML/CSS/JS
frontend, deployed on Render). `main` is clean and up to date with
`origin/main` at commit `6cce9b3`. Lesson storage now persists in a real
Postgres database (Neon) instead of an in-memory Map — see "What was
completed" below. Local dev server (`npm run dev`, port 3000) starts
cleanly, runs the DB migration on boot, and `/health` responds as
expected.

Core flow is functional end-to-end: a lesson request goes through a
planner agent → writer agent → (optional) SVG illustrator agent, blocks
can be edited/reordered/toggled/rewritten via the `/api/lesson` routes,
and voice playback + YouTube links are supported per block.

## What was completed

- Added an async lesson generation flow with progress polling and
  per-scene image controls (`c3b2cee`).
- Added an SVG illustrator agent (`3ba3927`) and fixed the SVG scene
  container to render on a white background with dark borders (`1f6f313`).
- Enforced strict topic adherence in the planner and writer prompts —
  lessons were drifting into related-but-unasked-for subjects, e.g. an
  equations lesson pulling in fractions/percentages (`553bcf1`).
- Replaced the separate play/pause voice controls with a single toggle
  button that tracks playback state and resets automatically at the end
  of playback (`7199f17`).
- Added `PUT /api/lesson/:id/block/:blockId/scene/:sceneIndex/image` and
  wired it into `handleFileUpload`/`submitImageUrl`/`revertToSvg` so a
  scene's custom image (uploaded file or pasted URL) is persisted on the
  server instead of only living in client-side `sceneData`, surviving
  page reloads (`52bb48c`).
- Added "Skapa från lärobok" (`1b5db4b`): a source-mode toggle lets a
  teacher generate a lesson strictly from photographed textbook pages
  instead of a free-typed topic. `src/agents/textbookReader.js` uses
  Claude Vision to transcribe the photos; `planLessonFromMaterial` /
  `materialStrictnessRule` restrict the planner and writer to facts
  literally present in that material; `express.json`'s body limit was
  raised to 15mb to fit base64-encoded page images.
- Split textbook-material generation into two endpoints and added a
  teacher confirmation step (`dbdeb18`):
  - `POST /api/lesson/extract-material` runs Vision synchronously and
    returns `{ title, text }` without generating anything yet.
  - `POST /api/lesson/generate-from-material` now takes the already-read
    `{ material: { title, text }, ... }` instead of raw images, so it
    never re-runs Vision; the `read` progress step is gone from this
    endpoint (and from the frontend's `STEP_ORDER` entirely).
  - `public/index.html` gained two screens between photo upload and
    generation: `#materialReading` (compact spinner while Vision runs)
    and `#materialConfirm` (editable title + textarea of the transcribed
    text, with "Tillbaka" back to the upload screen or "Skapa lektion
    från detta" to proceed) — so a teacher can catch and fix
    misread formulas, chemical indices or diagram text before the full
    lesson is generated from it.
  - Verified live with a Playwright-driven browser session against the
    real dev server (real Vision call): upload → read → confirm screen
    populated correctly → Tillbaka preserves the uploaded photos → confirm
    proceeds straight to the "Skapar lektionsplan..." loading step with
    no console errors.
- Added `checkMaterialFaithfulness({ lesson, material })` in
  `src/agents/checker.js`, alongside (not replacing) `checkLesson`
  (`d5c4746`). Where `checkLesson` judges factual *correctness*, this one
  judges source *faithfulness* — it walks the generated lesson block by
  block against the original material text and flags any fact, number,
  term, example or claim the writer added that isn't traceable back to
  it, even if true. Called only in `runGenerationFromMaterial`, result
  stored as `finalLesson.faithfulnessCheck` (kept separate from
  `finalLesson.check`); not wired into the frontend yet. Verified with a
  real generation from deliberately sparse material — correctly caught
  several writer-added elaborations (e.g. describing CO₂ as "a gas in
  the air", framing O₂ as a "biprodukt") that `checkLesson` didn't flag.
- Fixed a real reported bug where uploading several textbook photos could
  exceed the JSON body limit and Express would reply with an HTML error
  page instead of JSON, crashing the frontend's `res.json()` parse
  (`fbafc6d`):
  - `public/index.html`: photos are now downscaled client-side via canvas
    (max ~1600px on the long side, JPEG quality 0.85) before being added
    to `materialImages`, cutting payload size dramatically for
    phone-camera-resolution photos.
  - `src/index.js`: raised the `express.json` limit to 20mb (extra
    margin, not the primary fix) and added error-handling middleware so
    body-parser failures (oversized payload, malformed JSON) always
    return `{ error: '...' }` JSON with 413/400 instead of Express's
    default HTML error page.
- Fixed a second real bug, caught live in the dev server log: Claude
  Vision occasionally replies to the transcription prompt with prose
  around the JSON (e.g. "Here is a transcription... {...} Let me know if
  you need anything else!"), which crashed `JSON.parse(clean)` in
  `src/agents/textbookReader.js` with "Unexpected token 'H'" (`dd8c238`):
  - Added `tryParseJson()`, which falls back to slicing out everything
    between the first `{` and last `}` when a direct parse fails.
  - If that still fails, does exactly one retry with a stricter `system`
    instruction reusing the same photos, before finally throwing a
    meaningful error (still surfaced to the teacher as the existing
    generic 500).
  - Strengthened the original prompt to explicitly forbid preamble text,
    to reduce how often this happens in the first place.
  - Left a `TODO` noting `planner.js`/`writer.js`/`checker.js` have the
    same brittle `JSON.parse(clean)` pattern — not yet made robust, a
    separate future task.
  - Verified with a controlled test (monkey-patched the Anthropic SDK to
    reproduce the exact reported failure deterministically) plus a real
    Vision call against the live server.
- Migrated lesson storage from the in-memory `lessons` Map to a real
  Postgres database (Neon) (`6cce9b3`):
  - New `src/db/pool.js` — a single shared `pg.Pool` reading
    `DATABASE_URL`, SSL configured for Neon's managed cert chain.
  - New `src/db/schema.sql` — `lessons` table (`id`, `data` JSONB holding
    the full lesson object as-is, plus `subject`/`level`/`mode`/`title`/
    `status` broken out for a future list/filter screen, `created_at`/
    `updated_at`); run automatically as a `CREATE TABLE IF NOT EXISTS`
    migration at server startup in `src/index.js`.
  - New `src/db/lessonStore.js` — `getLesson`, `saveLesson` (upsert),
    `archiveLesson`, `listLessons({ status })`, `deleteLesson`.
  - `src/routes/lesson.js` rewired: every route handler that used
    `lessons.get`/`lessons.set` now awaits the store instead; the
    `lessons` Map is gone entirely.
  - New endpoint `PUT /api/lesson/:id/archive` — sets `status =
    'archived'` without deleting the lesson, for teachers to archive
    approved/finished lessons.
  - The separate `progress` Map (per-lesson `step`/`svg_done`/
    `svg_total` for `/status` polling during generation) was
    deliberately left as in-memory, ephemeral state — it only lives a
    couple of minutes per generation and doesn't need to survive a
    restart.
  - `DATABASE_URL` is confirmed set and working both on Render and
    locally in `.env` (untracked, gitignored).
  - Verified against the real Neon database: full CRUD cycle
    (insert/update/list/archive/delete) via a throwaway test script,
    then end-to-end through the actual API — generated a lesson, edited
    a block, fully stopped and restarted the dev server (not just a
    nodemon reload), and confirmed `GET /api/lesson/:id` still returned
    the lesson with the edit intact.
- Improved logging (`b29ffd6`): new `src/utils/logger.js` monkey-patches
  `console.log`/`warn`/`error` once, globally, to prepend a `[HH:MM:SS]`
  timestamp to every call in the project (no per-call-site changes
  needed), and exports `scoped(id)` to additionally tag lines with a
  `[lessonId]`/request-ID prefix so log lines from concurrent requests
  can be told apart. Wired into `runGeneration` and
  `runGenerationFromMaterial` in `src/routes/lesson.js` (tagged with a
  short `lessonId`) and into the `/extract-material` route (tagged with
  a fresh short request ID, plus a new start-of-request log line since
  that route previously only logged on error). Also added `error.stack`
  (not just `.message`) to the `catch` blocks in `extract-material`,
  `runGeneration`, and `runGenerationFromMaterial`, so future errors
  show exactly where in the code they originated instead of requiring
  guesswork from log context.

## Next steps

- Open bug, not yet root-caused: teachers have hit "Kunde inte läsa av
  läroboksfotona, försök igen" (the `/extract-material` failure path).
  The last attempt to reproduce it coincided in time with a separate,
  concurrent topic-mode generation request, and with no timestamps or
  request IDs in the logs at that point, the two requests' console
  output got interleaved and couldn't be told apart — so the real cause
  is still unconfirmed. Needs to be reproduced again in isolation (no
  other requests in flight) now that logging has timestamps, request
  IDs, and `error.stack` (see "What was completed" above), to get a
  clean diagnosis.
- Concrete geometry bugs spotted in AI-generated SVG illustrations: a
  light ray rendered passing straight through an object instead of
  reflecting off its surface at the correct point, and a spectrum
  illustration with the wrong number/order of colors. Logged here as
  cases to test against once a render→critique loop and/or a
  reasoning-before-draw prompt for the illustrator agent exists (see
  below) — not yet implemented.
- Add a "Mina lektioner" screen to the frontend — a list of
  saved/archived lessons (via the already-built `listLessons`), with the
  ability to open a previously generated lesson instead of generating it
  again.
- Build out a proper render→critique loop for the SVG illustrator: render
  the generated SVG to PNG server-side (`renderSVGToPNG` in
  `src/agents/illustrator.js`, using `resvg-js`, already added but not
  yet wired into the generation flow) → have Vision check the rendered
  image against what should be depicted → regenerate on mismatch.
  Architecture discussed, implementation not yet started.
- Auto-assign photos of textbook pages to lecture-block scenes in
  "material" mode (instead of, or alongside, the AI-generated SVG) —
  designed but not yet implemented.
- Investigate a user report of comprehension/interpretation errors in
  lessons generated via "Från lärobok" (the writer misunderstanding the
  text or a phenomenon it describes). Not yet started — need concrete
  screenshots from the user to diagnose before any fix can be scoped.
- Add `variants: { ai, textbook }` to the lesson/block content model, so
  a lesson can hold both an AI-generated version and a from-textbook
  version of its content side by side (rather than one replacing the
  other), with a way to switch between them per block.
- Per the README's stated roadmap: Google Classroom integration.
- Only one `TODO` marker in `src/` currently (in
  `src/agents/textbookReader.js`, see above — making `planner.js`/
  `writer.js`/`checker.js` equally robust against non-JSON prose in
  model replies); otherwise open work isn't tracked in-code, so next
  priorities should mostly come from the roadmap above or direct product
  feedback.
- Manually smoke test the full generation pipeline (topic → planner →
  writer → illustrator → SVG scenes) to confirm the topic-adherence and
  SVG container fixes hold up in practice.
