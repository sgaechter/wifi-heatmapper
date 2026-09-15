# Agent Notes for wifi-heatmapper

## Project overview

- Next.js 15 app (App Router) with a local Node backend, React frontend, WebGL heatmap rendering.
- Survey data is stored as plain JSON in `data/surveys/`; floorplan images live in `public/media/`.
- The app runs on the **host OS** (Windows/macOS/Linux). The Dockerfile is Linux-only because `--privileged` and `--net=host` do not expose host Wi-Fi on macOS/Windows.

## Essential commands

```bash
npm install
npm run dev          # dev server with Turbopack on http://localhost:3000
npm run typecheck    # tsc --noEmit
npm run check        # eslint src __tests__  (lint without --fix)
npm run lint         # eslint src __tests__ --fix
npm run test         # vitest run
```

CI order (matches `.github/workflows/ci.yaml`): `npm install` → `npm run check` → `npm run typecheck` → `npm run test`.

## Architecture gotchas

- **App Router**: API routes live under `src/app/api/**/route.ts`. Server-only modules are marked `"use server"`.
- **Path alias `@/`** maps to `src/*` via `tsconfig.json`.
- **WebGL heatmap** is rendered client-side in `src/app/webGL/`. The fragment shader builds a program per point count, so changing the number of survey points triggers a new shader compile.
- **Settings persistence**: `src/lib/fileHandler.ts` reads/writes via `src/app/api/settings/route.ts`. Sensitive fields (`sudoerPassword`) are stripped before saving. Writing uses a temp-file + rename with a direct-write fallback.
- **Test series**: each series is stored as a separate JSON file. Default series keeps the original filename `<floorplan>.json`; additional series use `<floorplan>.<seriesId>.json`.
- **Environment pre-fill**: `src/app/api/env-config/route.ts` exposes `SUDOER_PASSWORD` and `IPERF_SERVER_ADRS` from `.env` to the client settings. The real `.env` is gitignored; copy `.env.example` to `.env`.

## Code style & conventions

- ESLint config in `eslint.config.js`. Key rules: `semi: error`, `prefer-const: error`, `react/react-in-jsx-scope: off`, `unused-imports/no-unused-imports: error`. `@typescript-eslint/no-explicit-any` is off.
- `src/components/ui/**` is ignored by the unused-imports plugin.
- Avoid unused variables unless prefixed with `_`.
- The project uses TypeScript strict mode.

## Testing

- Tests are in `__tests__/` and run with Vitest.
- Platform-specific Wi-Fi parsing tests rely on captured command output fixtures under `__tests__/data/`.
- No integration test infrastructure (iperf3 server, Wi-Fi adapter) is required for `npm run test`.

## Common operational notes

- **iperf3**: TCP/UDP heatmaps only show data if the iperf server is set to something other than `localhost` and the server is reachable. `localhost` explicitly disables throughput tests.
- **macOS 15+**: SSID/BSSID may be redacted by the OS; the app works around SSID via `system_profiler`, but BSSID is often unavailable.
- **Linux**: `iw` and/or `nmcli` must be installed and in `PATH`.
- **Docker volume paths**: data is persisted at `./datas/data` and `./datas/media` on the host.
- **Build**: `npm run build` uses the default Next.js build; `next.config.mjs` does not enable static export by default.

## Files an agent should read when starting

- `README.md` and `docs/Theory_of_Operation.md` for the big picture.
- `package.json` for scripts and dependencies.
- `src/lib/types.ts` for the data model.
- `src/components/GlobalSettings.tsx` for how settings/state are loaded.
- `src/components/Floorplan.tsx` and `src/components/Heatmaps.tsx` for the main UI flows.
