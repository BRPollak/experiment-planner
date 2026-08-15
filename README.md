# Experiment Planner

A local-first experiment and task planner built around a full-screen monthly calendar. The application runs entirely on your computer and stores its data in SQLite; it has no accounts, cloud services, or external database.

## Requirements

- Node.js 22.12 or newer
- npm

## Development

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The Vite development server reloads the React UI as it changes, and the local API runs on port 8787.

## Local production build

```bash
npm run build
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173).

## Desktop application (macOS Apple silicon)

Run the Electron app directly from the project:

```bash
npm run desktop:run
```

Build an arm64 DMG with a local ad-hoc signature:

```bash
npm run desktop:dist
```

The installer is written to `release/`. The bundle is ad-hoc signed so macOS
can validate its files, but it is not Developer ID-signed or notarized. macOS
may therefore require you to Control-click the application, choose **Open**,
and confirm the first launch. No application is installed automatically.

The desktop application stores its database at
`~/Library/Application Support/Experiment Planner/experiment-planner.sqlite`.
The browser development server continues to use `data/experiment-planner.sqlite`.

To import an existing Experiment Planner SQLite database on the desktop app's
first launch, pass an absolute source path. Import is skipped if the desktop
database already exists, so this never replaces existing desktop data:

```bash
open -na "/path/to/Experiment Planner.app" --args \
  --import-legacy-db="/absolute/path/to/experiment-planner.sqlite"
```

## Data

The database is initialized automatically at `data/experiment-planner.sqlite` on first launch. SQLite foreign keys ensure every task belongs to an experiment and remove an experiment's tasks only after an explicit cascade confirmation from the interface.

To use a different database file for development or testing, set `EXPERIMENT_PLANNER_DB` to an absolute path before starting the server.

## Project structure

- `src/components/` — calendar, sidebar, and editor UI
- `src/lib/api.ts` — browser-side API access
- `server/database.ts` — SQLite initialization and data access
- `server/app.ts` — local HTTP API and application rules
- `shared/models.ts` — shared domain types
