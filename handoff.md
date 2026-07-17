# Handoff — Andvo Edu

_Last updated: 2026-07-16_

## Project status

Andvo Edu is an AI-powered lesson generator for Swedish schools (Node.js +
Express backend, Claude API for content generation, plain HTML/CSS/JS
frontend, deployed on Render). `main` is clean and up to date with
`origin/main` at commit `37d24e1`. No commits or local changes since the
last handoff update (2026-07-09) — the "What was completed" and "Next
steps" sections below are unchanged from last week and still reflect the
current state. Local dev server (`npm run dev`, port 3000) starts cleanly
and `/health` responds as expected.

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

## Next steps

- Use photos of textbook pages themselves as scene illustrations (instead
  of, or alongside, the AI-generated SVG) — discussed but not yet
  implemented.
- Investigate a user report of comprehension/interpretation errors in
  lessons generated via "Från lärobok" (the writer misunderstanding the
  text or a phenomenon it describes). Not yet started — need concrete
  screenshots from the user to diagnose before any fix can be scoped.
- Add `variants: { ai, textbook }` to the lesson/block content model, so
  a lesson can hold both an AI-generated version and a from-textbook
  version of its content side by side (rather than one replacing the
  other), with a way to switch between them per block.
- Per the README's stated roadmap: add persistence (PostgreSQL) —
  lessons currently appear to be in-memory/ephemeral — and Google
  Classroom integration.
- Only one `TODO` marker in `src/` currently (in
  `src/agents/textbookReader.js`, see above — making `planner.js`/
  `writer.js`/`checker.js` equally robust against non-JSON prose in
  model replies); otherwise open work isn't tracked in-code, so next
  priorities should mostly come from the roadmap above or direct product
  feedback.
- Manually smoke test the full generation pipeline (topic → planner →
  writer → illustrator → SVG scenes) to confirm the topic-adherence and
  SVG container fixes hold up in practice.
