# Repository Guidelines

## Project Structure & Module Organization

Fuller is a Node.js 20+ TypeScript terminal assistant built with Ink/React and Gemini. `src/index.tsx` defines the CLI; `src/headless.ts` handles noninteractive output. Core behavior lives in `src/agent/`, `src/tools/`, `src/permissions/`, and `src/session/`; terminal components and rendering live in `src/ui/`. Keep related changes in their existing module. Tests are in `tests/`, with fixtures in `tests/fixtures/`. `bin/fuller.js` is the published entry point, `scripts/` holds manual utilities, and `reports/` and `research_notes/` contain design notes. There is no separate asset directory; `dist/` is generated output.

## Build, Test, and Development Commands

- `npm install`: install dependencies from `package-lock.json`.
- `cp .env.example .env`: create local configuration, then set `GEMINI_API_KEY` for live runs.
- `npm run dev`: start the CLI directly from TypeScript with `tsx`.
- `npm run typecheck`: check strict TypeScript without emitting files.
- `npm test`: run the Vitest suite once; `npm run test:watch` reruns tests during development.
- `npm run build`: compile `src/` into `dist/`.

Run typecheck, tests, and build before publishing; `prepublishOnly` runs all three. For terminal resize work, use `python3 scripts/resize-test-vte.py` in a VTE terminal; its arguments are documented in `README.md`.

## Coding Style & Naming Conventions

Use the existing two-space indentation, single quotes, semicolons, and ESM imports with `.js` extensions for local TypeScript modules. Use `PascalCase` for React components and types, `camelCase` for functions and variables, and descriptive filenames matching their exported purpose. Keep UI code in `.tsx` files and non-UI logic in `.ts` files. No formatter or linter is configured; follow nearby code and use `npm run typecheck` for static checks.

## Testing Guidelines

Add focused Vitest tests as `tests/<feature>.test.ts` or `.test.tsx`; import source modules from `../src/...`. Cover behavior changes in agent, permission, tool, and UI code, especially terminal rendering and resize cases. The project sets no numeric coverage threshold. Prefer fixtures and mocks for external services so ordinary tests do not require an API key.

## Commit & Pull Request Guidelines

Recent commits use short, descriptive French subjects without a required prefix. Keep commits focused and name the user-visible change. In pull requests, explain the behavior, note relevant tests and configuration changes, and link an issue when one exists. Include a terminal capture or screenshot for visible TUI changes. Never commit `.env`, credentials, `node_modules/`, or generated `dist/` files.
