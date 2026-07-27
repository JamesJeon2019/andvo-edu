# Handoff — Andvo Edu

_Last updated: 2026-07-27_

## Project status

Andvo Edu is an AI-powered lesson generator for Swedish schools (Node.js +
Express backend, Claude API for content generation, plain HTML/CSS/JS
frontend, deployed on Render). `main` is clean and up to date with
`origin/main` at commit `d1b2f84`. Lesson storage now persists in a real
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
- Fixed a reported bug where the "Använd →" button (next to the URL input
  in "Ersätt bild" → "Klistra in länk" on a scene) wasn't visible, in two
  independent parts:
  - On narrow/mobile screens (`f8e3337`): `.editor-body` had no responsive
    breakpoint, so the fixed 240px `.sidebar` and `#mainContent` always
    split the viewport width evenly, even on a ~380px phone screen. That
    squeezed the scene card down to ~84px wide, forcing `.scene-paste-row`
    (whose `.tinput` has `min-width:180px`) to overflow its ancestor,
    which then got clipped by `.scene{overflow:hidden}` — the button
    existed in the DOM with no JS errors but was never painted. Fixed
    with a `@media (max-width:680px)` block that stacks `.editor-body`
    into a column and lets `.main` use the full width.
  - On desktop/wide screens (`ae5a81f`) — a second, unrelated bug, not a
    width issue: `.editor-header` is `position:sticky;top:0;z-index:10`,
    and if a scene's controls row happens to land near the top of the
    page after scrolling (common on any real multi-block lesson), the
    sticky header visually *and* functionally overlaps the row —
    confirmed with `document.elementFromPoint()` on the button's
    coordinates returning `.editor-header`, not the button, i.e. clicks
    there were being swallowed by the header. Fixed by adding
    `scrollRowBelowHeader()`, called from `togglePasteRow`/
    `toggleReplaceRow`/`toggleInstructionRow`, which nudges the page
    scroll so a just-opened row always ends up clear of the header.
  - Both verified with Playwright against the real dev server (mobile
    380×720 viewport and desktop 1920×1080 with a multi-scene lesson
    scrolled to reproduce each case), including before/after screenshots
    and a real click through to `submitImageUrl` → `/api/image/validate`.
- Added a shareable lesson URL and a "Mina lektioner" list screen
  (`a755a0c`), frontend-only, on top of the already-existing
  `GET /api/lesson` / `PUT /api/lesson/:id/archive` endpoints:
  - `public/index.html`: opening a lesson (after generation or from the
    list) now calls `history.pushState` to set `?lesson=<id>` in the URL;
    on page load, `initFromUrl()` checks for that param and loads the
    lesson directly via `GET /api/lesson/:id` instead of showing the
    setup screen. A `popstate` handler keeps the browser's back/forward
    buttons working correctly.
  - New "Mina lektioner" screen, reachable from the setup screen, lists
    saved lessons (title, subject, mode AI/lärobok, status
    utkast/arkiverad, formatted `created_at`) via `GET /api/lesson`;
    clicking a row opens it through the same `openLessonById()` path used
    by the URL param.
  - New "📁 Arkivera" button in the editor header calls
    `PUT /api/lesson/:id/archive` and hides itself once archived. Since
    `GET /api/lesson/:id` only returns the lesson's `data` blob (no
    `status` column), `openLessonById()` also fetches `GET /api/lesson`
    to look up that row's status.
  - Verified end-to-end with Playwright against the real dev server:
    generated a real test lesson, opened its exact `?lesson=` URL in a
    brand-new page (simulating paste-into-new-tab), confirmed it loaded
    directly with the right title; confirmed the lesson appeared in
    "Mina lektioner" and opening it from the list worked; archived it and
    confirmed the button stayed hidden across a reload and the list
    showed "Arkiverad".
- Made `POST /api/image/validate` resilient to sites that reject
  non-browser requests (`8282e60`) — many image hosts (Google Images,
  stock-photo sites, most CDNs) were returning 403/HTML for a bare HEAD
  request, failing validation even for links that work fine in a real
  browser:
  - Added a realistic desktop Chrome `User-Agent` header to both the HEAD
    and GET(fallback) requests.
  - Added a 5s timeout via `AbortController` on each request (previously
    unbounded).
  - Added a GET fallback with `Range: bytes=0-1024` (only the first ~1KB
    is fetched, not the whole image) for hosts that don't support HEAD
    correctly (405, or any non-2xx status) or where HEAD errors out or
    times out; if HEAD itself succeeds (2xx), its result is trusted
    directly with no extra request.
  - `redirect: 'follow'` set explicitly (fetch's default, but locked in
    and verified against a real 302).
  - Verified against real image URLs from multiple sources (Wikimedia
    direct `.jpg`, Google's own `gstatic.com` CDN, Khan Academy's
    educational CDN, a Shutterstock preview CDN URL, and an imgur
    redirect) — all now pass; a real HTML page and a nonexistent domain
    correctly still fail. Also verified the GET-fallback path itself
    against a local mock server that returns 405 on HEAD and a real
    image on GET, and the timeout against a local mock server that never
    responds (correctly bounded at ~10s, not indefinite).
- Added a render→critique loop for automatic SVG illustration generation
  in `illustrateLesson`/`illustrateBlockScenes` (`ac053cf`): the generated
  SVG is rendered to PNG server-side via `renderSVGToPNG` (`resvg-js`),
  then a Vision critic (`critiqueSVG` in `src/agents/illustrator.js`)
  checks it against the scene's `voice_text` for general error patterns —
  rays/lines passing through opaque objects instead of reflecting or
  stopping at the surface, element count not matching what the text
  implies, arrow directions contradicting the text, and labels that don't
  match what's drawn. On `ok: false`, exactly one regeneration is done via
  `generateSVG(voiceText, blockType, subject, critique.issue)`, using the
  critic's issue as the existing `instruction` param, and that result is
  accepted as final regardless of what a repeat critique would say — the
  critic has a known false-positive rate like any vision-based reviewer,
  so it deliberately does not retry-loop. NOT applied to the teacher's
  manual "Rita om"/"Ge instruktion" regenerate-svg route — that's a
  human-in-the-loop flow already, where automatic critique could
  contradict an explicit teacher instruction. Verified on a real full
  lesson generation (Fysik, "Ljusets reflektion och brytning"): the critic
  flagged real issues on 12 of 19 scenes (incidence/reflection angle
  mismatches, a normal line drawn through an opaque mirror, reversed
  arrow directions), and illustration-step generation time increased
  ~2.2× (roughly 15-18s/scene before to ~39s/scene average blended after,
  on this topic's high critique-trigger rate).
- Made `checkLesson`/`checkMaterialFaithfulness` resilient to non-JSON
  prose in the model's reply (`fb1a551`): the `tryParseJson()` helper
  (previously local to `src/agents/textbookReader.js`) was moved to a
  shared `src/utils/jsonParse.js`; both checker functions now call it
  instead of a bare `JSON.parse(clean)`, with an explicit `null` check
  that throws so the existing try/catch fallback (unchanged —
  `status: 'ok'`, `summary: 'Faktagranskning hoppades över'` /
  `'Källtrohetskontroll hoppades över'`) still triggers on a genuinely
  unparseable reply. The `TODO` about this brittle pattern now lists only
  `planner.js`/`writer.js` as remaining. Verified with a mocked Anthropic
  SDK (no real API calls): a JSON reply wrapped in prose is now correctly
  recovered and used instead of falling back, while a truncated/
  unparseable reply (reproducing the real "Unterminated string in JSON"
  incident) still falls back exactly as before.
- Added auto-assign of textbook page photos to lecture-block scenes in
  "material" mode (`c2c5287`): new `src/agents/sceneImageMatcher.js`
  (`assignSourceImages`), wired into `runGenerationFromMaterial` right
  after `writeLesson`, before `illustrateLesson`. Only called for
  `type === 'lecture'` blocks — task/test blocks are skipped entirely,
  never even attempted. The AI SVG illustrator still runs for every scene
  as before, untouched — a scene's `custom_image` (when auto-assigned) is
  just picked up by the frontend's existing image-over-svg render
  priority, so the photo becomes the default illustration with no
  render-side changes needed. `finalLesson.sourceImages` is now
  persisted, for a future manual "pick a different page" control for
  teachers (not built yet). Verified on a real generation (Geografi,
  "Vattnets kretslopp"): 4 scenes in the lecture block correctly got the
  actual uploaded photo as `custom_image`, task/test blocks got none.
  Cost: ~2.4s for one Vision call per lecture block (not per scene) — an
  order of magnitude cheaper than the illustrator's render→critique loop.
- Made `planner.js`/`writer.js` JSON parsing resilient to non-JSON prose
  in the model's reply, using the same `tryParseJson()` already used by
  `checker.js`/`textbookReader.js` (`6d1de67`): both call sites in
  `planner.js` (`planLesson`, `planLessonFromMaterial`) and the one in
  `writer.js` (`writeBlock`) now call `tryParseJson()` instead of a bare
  `JSON.parse(clean)`. Unlike the checker's graceful fallback, there's no
  fallback to fall back to here — the plan/content IS the lesson, so on a
  genuine parse failure (`null`) each site does an explicit `throw` that
  surfaces exactly as before, via the existing `try`/`catch` in
  `routes/lesson.js` (unchanged). The goal was purely to lower how often
  that failure happens, not to add a new fallback path. The `TODO` in
  `src/utils/jsonParse.js` about this brittle pattern is now removed —
  all known call sites are covered. Verified with a mocked Anthropic SDK
  (no real API calls) on all three functions, both scenarios: a JSON
  reply wrapped in prose is now correctly recovered, while a genuinely
  unparseable/truncated reply still throws the same as before.
- Lowered the `POST /api/image/validate` timeouts from 5s to 3s per
  request (HEAD + GET-fallback) (`040ecb9`) — the old 5s+5s combination
  meant a teacher pasting an obviously broken link could wait up to ~10s
  before finding out. Verified with the same test set used when this
  endpoint was first hardened (`8282e60`, see above): real image URLs
  from multiple sources still validate in well under a second, a
  nonexistent domain still fails fast, and a hung local mock server
  (worst case) now bounds at ~6s instead of ~10s.
- Created `scripts/illustration-audit.js`, syntax-checked (`node
  --check`) — a one-off illustration quality audit script, not a
  feature of the app. Generates 8 test lessons (2 topics × 4 subjects:
  Kemi, Biologi, Fysik, Matematik) directly through
  `planLesson`→`writeLesson`→`illustrateLesson`, no HTTP, no DB writes.
  Collects every scene's `svg_content` into
  `scripts/illustration-audit-output.html`, grouped by subject then
  topic, each illustration shown with its block type and `voice_text`.
  Per-topic error handling — a failed topic is logged and shown as an
  error in the output instead of stopping the other 7. DELIBERATELY NOT
  in git (untracked) — exists only locally on the user's machine. Run
  with `node scripts/illustration-audit.js` (needs `.env` with
  `ANTHROPIC_API_KEY`). Not yet run — deferred to a separate session, since
  it takes an hour or two of real time plus a noticeable API budget, and
  the machine needs to stay on for the whole run.
- Removed the automatic `history.pushState` on normal lesson open/
  generation (`d1b2f84`): `renderEditor()` no longer changes the URL by
  itself. Previously this made a browser refresh silently "remember" the
  last-opened lesson instead of resetting to the start screen, which read
  as a bug — now a refresh always returns to the start screen. Added an
  explicit "🔗 Kopiera länk" button on the finished-lesson screen, next to
  "📁 Arkivera" — on click it builds a `?lesson=<id>` link and copies it to
  the clipboard, without changing the visible address bar. The direct-link
  logic (`?lesson=<id>` on page load, `popstate`) was left untouched and
  still works exactly as before. Also fixed a stale `confirm()` string in
  `backToSetup()` ("Lektionen sparas inte permanent än" — no longer true,
  lessons have persisted to the DB for a while now).
- Починен автодеплой Render — оказалось, GitHub App от Render не имел
  доступа к репозиторию andvo-edu вообще (только к отдельному
  andvo-backend), поэтому события о пушах не долетали с 17 июля до 25
  июля включительно, несмотря на то, что Auto-Deploy был включён ("On
  Commit"). Исправлено через github.com/settings/installations → Render
  → добавлен доступ к andvo-edu. Подтверждено тестовым пустым коммитом —
  автодеплой снова срабатывает сам.
- Добавлена `detectDiagrams(images, language)` в `src/agents/
  textbookReader.js` — находит диаграммы/схемы на фото учебника (не
  текст, не декоративные фото), возвращает объяснение содержания +
  координаты (`bbox`, доли 0-1 от размера изображения). Не интегрирована
  в основной пайплайн — первый изолированный шаг переработки
  material-режима (см. план в "Next steps" ниже). Проверено на 2 реальных
  фото страниц учебника: правильно нашла диаграмму (не спутала с
  текстовыми врезками/упражнениями), bbox-координаты визуально точны при
  вырезании с padding.
  ВАЖНАЯ ТЕХНИЧЕСКАЯ НАХОДКА для следующего шага (вырезание диаграмм
  через `sharp`): телефонные фото несут EXIF-тег ориентации (например,
  6 = поворот на 90° по часовой) — сырой JPEG-буфер landscape
  (4032×3024), но контент страницы portrait после поворота согласно
  EXIF. Bbox-координаты от Claude Vision относятся к УЖЕ ПОВЁРНУТОМУ
  (EXIF-corrected) изображению, а не к сырому буферу как он хранится
  физически. Реализация crop через `sharp` ОБЯЗАТЕЛЬНО должна сначала
  применить EXIF-поворот (`sharp` делает это автоматически через
  `.rotate()` без аргументов, если вызвать перед `.extract()`) — иначе
  вырезание попадёт не в ту область на любом фото, снятом в portrait-
  ориентации (то есть на большинстве обычных телефонных фото документов).
- Прокинуты найденные диаграммы через `planLessonFromMaterial` →
  `writeBlock` (шаг 3 плана переработки material-режима, после
  `detectDiagrams` и `cropDiagram`): `runGenerationFromMaterial` теперь
  вызывает `detectDiagrams(sourceImages, language)` сразу после
  `planLessonFromMaterial`, прицепляет результат как `plan.diagrams`. В
  `writer.js` добавлена `diagramsInstructionsFor()` — для lecture-блоков
  (только), если `lessonContext.diagrams` непустой, промпт получает
  список найденных диаграмм (label + explanation) и инструкцию помечать
  сцену полем `diagramIndex`, если её содержание соответствует конкретной
  диаграмме. Task/test блоки и случай без диаграмм не затронуты.
  Проверено на реальном уроке (Kemi, металлическая связь) — все
  помеченные сцены фактически согласованы с содержанием своих диаграмм,
  несколько почти дословных совпадений, ни одного противоречия. Одна
  диаграмма была найдена, но не привязана ни к одной сцене — подтверждено
  как ожидаемое поведение (не каждая найденная диаграмма обязана
  использоваться). `cropDiagram` (из предыдущего шага) в этом пайплайне
  пока НЕ вызывается — реальное вырезание фото для показа на сцене и
  заземление самого SVG-иллюстратора на эту диаграмму — следующий шаг
  (шаг 4).

## Next steps

- Resolved / false alarm: the previously-logged "Kunde inte läsa av
  läroboksfotona, försök igen" report (the `/extract-material` failure
  path) was investigated further. The real cause turned out to be an
  exhausted Anthropic API balance and/or several generations running
  concurrently at the time, not a bug in the code — closing this out, no
  code fix needed.
- ПЕРЕСМОТРЕН план для material-режима (заменяет предыдущую диагностику
  `assignSourceImages`/`sceneImageMatcher.js`) — первый шаг уже сделан:
  `detectDiagrams()` (см. "What was completed" выше). Текущий подход "текст →
  искать подходящее фото постфактум" на практике ни разу не сработал —
  пользователь подтверждает, что за всё время использования ни одна
  сцена ни разу не получила реальное фото учебника как иллюстрацию,
  всегда только AI SVG. Новый план переворачивает порядок причины и
  следствия: Vision должен СНАЧАЛА разобрать загруженные фото учебника и
  объяснить содержание диаграмм своими словами (может опираться на
  буквальный текст учебника рядом с диаграммой), и только ПОТОМ на основе
  этого понимания писать текст сцены (`voice_text`) и/или иллюстрацию.
  Дополнительно: одно фото страницы часто содержит несколько отдельных
  диаграмм, поэтому Vision должен вернуть не только объяснение, но и
  bounding box каждой найденной диаграммы на изображении, чтобы сервер
  мог вырезать (crop) именно нужный кусок фото — не всю страницу целиком —
  для показа как иллюстрации конкретной сцены. Координаты от Vision не
  всегда точны (та же природа неточности, что уже наблюдалась с
  геометрией — см. закрытый стратегический вопрос про точность
  иллюстраций ниже), поэтому при вырезании нужен небольшой padding вокруг
  заявленной области, чтобы не обрезать диаграмму по краю при небольшой
  погрешности координат. Итоговая логика по каждой сцене с обнаруженной
  диаграммой: (1) вырезанный (не вся страница) кусок реального фото
  показывается как источник/доказательство, сопровождаемый словесным
  объяснением содержания диаграммы; (2) AI SVG-иллюстрация рисуется
  заземлённой на ту же диаграмму (иллюстратор получает и вырезанное фото,
  и словесное объяснение) — как дополнение, упрощающее/переформулирующее
  её понятнее для ученика, а не замена; (3) единый визуальный стиль по
  всему уроку обеспечивается тем, что AI SVG генерируется всегда. Статус:
  шаги 1-3 из ~6 закрыты (см. "What was completed" выше) —
  `detectDiagrams()` (шаг 1, находит диаграммы + explanation + bbox),
  `cropDiagram()` (шаг 2, вырезает нужный кусок фото с padding, включая
  EXIF-поворот), и прокидывание найденных диаграмм через
  `planLessonFromMaterial` → `writeBlock` с пометкой `diagramIndex` на
  сценах (шаг 3). Осталось:
  - Шаг 4: заземление иллюстратора — для сцен с `diagramIndex` вызвать
    `cropDiagram`, передать вырезанное фото + explanation в `generateSVG`
    (`illustrator.js`), чтобы SVG рисовался с оглядкой на реальную
    диаграмму, не только на текст сцены.
  - Шаг 5: фронтенд — показать вырезанное фото + AI-версию рядом на сцене
    (новая вёрстка, переиспользующая существующие `custom_image`
    контролы).
  - Шаг 6: вывести из эксплуатации `sceneImageMatcher.js`/
    `assignSourceImages` (старый постфактум-подход, который заменяется
    новым) — не должны сосуществовать оба механизма одновременно.
  Пересмотренная оценка: 3 из ~6 шагов плана закрыты за меньше времени,
  чем ожидалось изначально — реалистично осталось 2-3 сессии, а не 3-5 на
  весь план, как оценивалось в начале.
- Closed strategic question: is illustration quality/accuracy good enough
  to actually sell this to teachers outside internal use? Decision made
  after a manual audit of 8 lessons (153 illustrations total) — the
  current quality level is accepted as sufficient for this version. Known
  gaps are deliberately NOT being chased further right now, e.g. subtle
  geometric inaccuracies (a "topp"/peak label on a wave graph offset by a
  few pixels from the curve's actual peak — a different class of error
  than gross conceptual ones like a ray passing straight through an
  object, and one the existing Vision critic, see render→critique loop
  under "What was completed" above, is bad at catching because it looks
  almost fine even to a Vision model). A programmatic (non-Vision)
  geometric check was discussed as an alternative but rejected for now —
  it would only apply narrowly (mainly Matematik/Fysik), doesn't scale to
  Kemi/Biologi, is brittle to changes in the illustrator prompt, and needs
  separate code per new diagram class. Waiting instead on future
  underlying-model quality improvements rather than investing more effort
  here now.
- Первая попытка запуска `node scripts/illustration-audit.js` (25 июля)
  была прервана на середине (2 из 8 тем обработано — Fysik первая тема,
  Biologi "Fotosyntes") из-за непреднамеренного завершения фонового
  процесса, причина не установлена (не настройки энергосбережения — они
  были в порядке). Результат того прогона потерян (скрипт тогда писал
  HTML только в самом конце). Скрипт доработан — теперь
  `illustration-audit-output.html` перезаписывается после КАЖДОЙ
  обработанной темы, а не только в конце, так что повторный обрыв больше
  не уничтожит весь накопленный результат. Готов к повторному запуску
  (`node scripts/illustration-audit.js`), пока отложено на другое время.
- Per the README's stated roadmap: Google Classroom integration.
- General pattern worth keeping in mind for future UI work: any
  toggled/collapsible control that gets revealed near the top of the page
  (like the scene "Klistra in länk" row) can end up hidden under the
  sticky `.editor-header` depending on scroll position, the same way the
  "Använd →" button did. New elements like this should either call
  `scrollRowBelowHeader()` (see "What was completed" above) or otherwise
  account for the sticky header when they open.
- No multi-user architecture yet: there's no teacher authentication, and
  `GET /api/lesson` currently returns every lesson in the database to any
  caller with no per-user scoping. Needs discussion (who owns a lesson,
  what auth approach, expected load) before this goes live for multiple
  schools/teachers at once.
- Решение принято (реализация не начата): НЕ использовать Google
  OAuth/Classroom для авторизации сейчас — Google Classroom в Швеции
  завязан на Skolverket, это отдельный, гораздо более глобальный уровень
  интеграции, не относящийся к текущей цели (продажа отдельным школам
  как самостоятельный инструмент между учителями внутри школы, не
  национальная инфраструктура). Вместо этого: простая модель "school" —
  таблица `schools` в БД (название, логин, хеш пароля), уроки привязаны к
  `school_id` (не к отдельному учителю — все учителя одной школы видят
  уроки друг друга, изоляция только между разными школами), простой
  экран входа/сессия, защита роутов по `school_id`. Google Classroom
  интеграция отложена как отдельная, возможно нереализуемая для
  отдельных школ тема — не блокирует и не влияет на текущую архитектуру.
  Не начато реализовывать.
- (Minor, not urgent) `POST /api/image/validate` can still take up to
  ~6s on a genuinely broken link (3s HEAD timeout + 3s GET-fallback
  timeout, both via `AbortController` — lowered from 5s+5s, see "What
  was completed" above). Consider shortening further if this still
  generates slowness complaints.
- Render's free-tier web service spins down after 15 minutes of
  inactivity; the next request then pays a 30-60s cold-start penalty. At
  real usage — teachers hitting the site from different devices at
  different times of day — this will look like "the site is down", not
  "the site is slow". Deliberately deferred: real school usage doesn't
  start until 2026-08-10, so there's time. Decision (already made, no
  code/infra change yet): upgrade to Render's paid Starter tier (~$7/
  month), which removes the spin-down entirely — this is settled, not
  just a recommendation, but no specific date/moment has been chosen for
  when to actually click the upgrade in Render's dashboard; just needs
  doing before 2026-08-10. Do NOT paper over this with an external
  keep-alive ping in the meantime — that doesn't avoid the problem, it
  just burns through the free tier's 750 hours/month workspace-wide limit
  faster.
