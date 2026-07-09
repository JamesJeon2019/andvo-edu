# Handoff — Andvo Edu

_Last updated: 2026-07-09_

## Project status

Andvo Edu is an AI-powered lesson generator for Swedish schools (Node.js +
Express backend, Claude API for content generation, plain HTML/CSS/JS
frontend, deployed on Render). `main` is up to date with `origin/main` at
commit `1b5db4b`, plus the uncommitted "Från lärobok" confirmation-screen
work described below. Local dev server (`npm run dev`, port 3000) starts
cleanly and `/health` responds as expected.

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
  teacher confirmation step (uncommitted — staged for the next commit):
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

## Next steps

- Add `variants: { ai, textbook }` to the lesson/block content model, so
  a lesson can hold both an AI-generated version and a from-textbook
  version of its content side by side (rather than one replacing the
  other), with a way to switch between them per block.
- Per the README's stated roadmap: add persistence (PostgreSQL) —
  lessons currently appear to be in-memory/ephemeral — and Google
  Classroom integration.
- No `TODO`/`FIXME` markers currently in `src/`, so open work isn't
  tracked in-code; next priorities should come from the roadmap above or
  direct product feedback.
- Manually smoke test the full generation pipeline (topic → planner →
  writer → illustrator → SVG scenes) to confirm the topic-adherence and
  SVG container fixes hold up in practice.
