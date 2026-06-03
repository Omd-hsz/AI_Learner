# Project rules — AI Learning Companion

These rules apply to any AI/human working in this repo. (Also mirrored in `.cursorrules`.)

## What this project is

A local-first, installable PWA that teaches AI from a fixed curriculum
(`public/curriculum.json`). The user picks a topic, the app calls an LLM API with
their own key, and the generated lesson is cached on-device (IndexedDB) so
revisiting it costs no tokens and works offline. Progress, flashcards, and quiz
scores are all stored locally. There is **no backend** and it deploys free on
GitHub Pages.

## Coding rules (follow these)

- **Explain each file's purpose in inline comments** — the student reading this is
  a beginner. Every file starts with a header comment saying what it does and why.
- **Prefer simple, readable code over clever one-liners.**
- **After each function, note edge cases it does NOT handle** (see the
  `// Edge cases this file does NOT handle:` blocks at the bottom of each file).
- **Don't add a library without saying why it's worth it.** Current dependencies
  and their justification:
  - `react` / `react-dom` — the UI framework.
  - `vite` + `@vitejs/plugin-react` — fast dev server and build tool.
  - `vite-plugin-pwa` — auto-generates the service worker + manifest (installable
    + offline) so we don't hand-write a service worker.
  - `idb` — tiny promise wrapper over IndexedDB (the raw API is very clunky).
  - `marked` — turns the LLM's markdown into HTML.
  - `dompurify` — sanitizes that HTML before we inject it (security).
  - `gh-pages` (dev) — one-command deploy to GitHub Pages.
- **On errors, diagnose the root cause before fixing.** Don't paper over a symptom.

## Key behavior that must not regress

- API key lives **only** in this device's `localStorage`; it is sent only to the
  LLM provider. Public visitors must enter their own key. Always show the
  low-spending-cap warning.
- A lesson is generated **once** and cached. The only way to spend tokens again on
  a cached lesson is the **Regenerate** button.
- Flashcards/quizzes must use the **cheap** model; lessons use the **premium**
  model.
- All data is exportable/importable as JSON (the only backup mechanism).

## Architecture map

```
src/
  lib/        pure logic, no React (db, storage, api, prompts, srs, parse)
  components/ React screens (Home, Lesson, Flashcards, Quiz, Settings, ...)
  App.jsx     screen routing + shared state
public/
  curriculum.json   the fixed course outline
  icon.svg          app icon
```
