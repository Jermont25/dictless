# Repository Guidelines

## Project Structure & Module Organization

This is a local-only React 19, TypeScript, and Vite application. Application flow lives in `src/App.tsx`. Put reusable interface primitives in `src/components/ui/`, browser-specific behavior in `src/hooks/`, and API or shared helpers in `src/lib/`. Styling starts in `src/index.css` and is configured with Tailwind.

`vite.config.ts` owns the local OpenAI proxy; keep server-only configuration there.

## Build, Test, and Development Commands

```bash
cp .env.example .env.local  # create local API-key configuration once
npm install                 # install dependencies
npm run dev                 # start Vite and the local OpenAI proxy
npm run build               # type-check and build to dist/
npm run preview             # serve the built app locally with the proxy
npm run lint                # lint TypeScript and TSX under src/
npm run lint:fix            # apply safe ESLint fixes
npm run format:check        # verify Prettier formatting
npm run format              # format repository files
```

## Coding Style & Naming Conventions

Use TypeScript and functional React components. Prettier is authoritative: two-space indentation, double quotes, no semicolons, and trailing commas. Name components in `PascalCase` (`AudioPanel.tsx`), hooks as `useX` (`useAudioRecorder.ts`), and utility modules in lowercase (`openai.ts`). Prefer the `@/` alias for imports under `src/`.

Extract UI logic only when it is reusable. Preserve Spanish UI copy unless changing language.

Do not add source-code comments. Make intent clear through names, types, and small functions. Comments are allowed only in `AGENTS.md`, `README.md`, and `.env.example`.

## Testing Guidelines

No automated test framework or coverage target is configured. Before handing off a change, run `npm run format:check`, `npm run lint`, and `npm run build`. For audio or UI changes, manually verify microphone permission, start/stop recording, transcription, editing, copying, and clearing in a browser.

## Security & Configuration

Store the key only as `OPENAI_API_KEY` in `.env.local`; it is ignored by Git. Never use a `VITE_` prefix, put a key in client code, or commit `.env.local`. The Vite proxy is for localhost only and is not a deployment backend.

## Commits & Pull Requests

This checkout has no Git metadata, so no repository-specific history convention is available. Use short, imperative Conventional Commit-style messages, for example `feat: add language selector` or `fix: handle microphone denial`. Keep commits focused. Pull requests should describe the behavior change, list validation commands, link relevant issues, and include screenshots for visible UI changes.
