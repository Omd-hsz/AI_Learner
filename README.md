# 🧠 AI Learning Companion

A **local-first, installable PWA** that teaches AI from a fixed curriculum
(foundations → advanced). You pick a topic, the app calls an LLM with **your own
API key**, and the generated lesson is **cached on your device** so revisiting it
is free and works offline. Progress, flashcards (spaced repetition), and quiz
scores all live in your browser. **No backend.** Deploys free on GitHub Pages.

## Highlights

- 📚 **Curriculum-driven** — modules and topics come from `public/curriculum.json`.
- 💸 **Token-friendly** — each lesson is generated once and cached. Only the
  **Regenerate** button spends tokens again.
- 🔁 **Spaced-repetition flashcards** — cards parsed from each lesson, reviewed on
  day 1, 3, 7, 16. The home/Cards tab shows how many are due.
- 📝 **Quiz me** — retrieval quizzes over completed topics (uses the cheap model).
- 🗣️ **Teach-back, "I'm stuck" hints, and free-text follow-ups** continue the same
  lesson conversation.
- 🔒 **Your key, your device** — the API key is stored only in `localStorage` and
  sent only to the LLM provider. Other visitors must enter their own key.
- 📦 **Export / Import JSON** — your only backup, since data is local-only.
- 📲 **Installable & offline** — add it to your home screen; cached lessons work
  with no connection.

## Quick start (local dev)

```bash
npm install
npm run dev
```

Open the printed URL. On first use you'll be asked for an API key.

> ⚠️ **Use a key with a low spending cap.** A runaway loop should never be able to
> run up a big bill.

### Choosing a provider

**Default: LiteLLM (Divar team gateway)** — OpenAI-compatible proxy at
`https://litellm.data.divar.cloud`. Paste your team `sk-…` key in Settings.

Recommended models on the Divar key (from team pricing; click **Fetch available
models** to see your key's live list):

| Role | Model | Why |
| ---- | ----- | --- |
| **Lessons (best value)** | `gemini-2.5-flash` | ~$0.30/$2.50 per 1M tokens; strong at structured markdown, code, and explanations. Used elsewhere in Divar tooling for summaries. |
| **Quizzes / flashcards (cheapest)** | `grok-4-1-fast-non-reasoning` | ~$0.20/$0.50 per 1M tokens; fine for short MCQ generation. |
| **Upgrade if you want richer lessons** | `claude-sonnet-4-5-20250929` | Better pedagogy, ~10× the cost of gemini-2.5-flash. |

You can also switch to direct `anthropic` or `openai` in Settings if you prefer.

| Provider  | Premium (lessons) | Cheap (cards/quiz) |
| --------- | ----------------- | ------------------ |
| litellm (default) | `gemini-2.5-flash` | `grok-4-1-fast-non-reasoning` |
| anthropic | `claude-sonnet-4-5` | `claude-haiku-4-5` |
| openai    | `gpt-4o`            | `gpt-4o-mini`      |

If a model name is rejected, the app fetches the provider's live model list and
auto-picks a valid one (you can also click **Fetch available models**).

## Deploying to GitHub Pages

### Option A — automatic (recommended)

1. Push this folder to a GitHub repo.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub
   Actions**.
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds the app
   and publishes it. It sets the base path from your repo name automatically.

Your site will be at `https://<username>.github.io/<repo-name>/`.

### Option B — manual one-liner

```bash
# Set the base to your repo name so asset URLs resolve on the subpath.
GHPAGES_BASE=/<repo-name>/ npm run deploy
```

This builds and pushes the `dist/` folder to a `gh-pages` branch using the
`gh-pages` package. Then set **Settings → Pages → Source: Deploy from branch →
`gh-pages`**.

> **Base path matters.** A GitHub Pages *project* site is served from
> `/<repo-name>/`. The build must know that prefix or assets 404. The Action sets
> it for you; for manual builds pass `GHPAGES_BASE`. For a custom domain or a
> `username.github.io` user-site, use `GHPAGES_BASE=/`.

## How it works (file map)

```
public/
  curriculum.json     the fixed course outline (edit to change topics)
  icon.svg            app icon (PWA)
src/
  main.jsx            mounts React
  App.jsx             screen routing + shared state + first-use key prompt
  styles.css          all styling (one plain CSS file)
  lib/
    db.js             IndexedDB (lessons cache, progress, flashcards, scores)
    storage.js        localStorage (API key + settings)
    api.js            providers + SSE streaming + model-list recovery
    prompts.js        SYSTEM_PROMPT + FOUNDATION add-on
    srs.js            spaced-repetition schedule (day 1/3/7/16)
    parse.js          pull flashcards / quiz JSON out of model replies
  components/
    Home.jsx          curriculum + progress bars + status badges
    Lesson.jsx        generate/stream/cache + regenerate + stuck + teach-back
    Flashcards.jsx    review due cards
    Quiz.jsx          multiple-choice quiz over completed topics
    Settings.jsx      key, provider/model, export/import, reset
    Markdown.jsx      safe markdown rendering
    ProgressBar.jsx   reusable progress bar
```

## Privacy

Everything is on your device. The app has no server and collects nothing. Your
API key never leaves your browser except in the direct request to the LLM
provider you chose.

## License

MIT — do whatever you like.
