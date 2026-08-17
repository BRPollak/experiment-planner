# Experiment Planner

Experiment Planner is a private, local-first macOS app for organizing experiments and their tasks in month and week calendar views.

Use separate calendars for different projects, group work into color-coded experiments, and schedule tasks with optional times and notes. Everything is stored locally on your Mac—there are no accounts, cloud services, or external databases.

## Install on macOS

Experiment Planner currently supports Apple silicon Macs running macOS 12 or newer.

1. Open the [latest Experiment Planner release](https://github.com/BRPollak/experiment-planner/releases/latest).
2. Download `Experiment Planner-<version>-arm64.dmg` from the latest release.
3. Open the downloaded DMG.
4. Drag **Experiment Planner** into the **Applications** folder.
5. Open Experiment Planner from Applications.

### If macOS blocks the app

The app is not currently notarized by Apple, so macOS may block it the first time you open it.

1. Try to open **Experiment Planner** from Applications.
2. Open **System Settings**, then go to **Privacy & Security**.
3. Scroll down and click **Open Anyway** for Experiment Planner.
4. Confirm that you want to open the app.

Installing a newer version does not remove your existing planner data.

## How to use it

1. Create a **calendar** for a project or area of work.
2. Create one or more color-coded **experiments** inside that calendar.
3. Use the plus button on a calendar day, or open a day and select **Add task**.
4. Give the task a date, optional time, experiment, and notes.
5. Use a task's checkbox to mark it complete, or click the task to edit it.
6. Drag a task to another day to reschedule it.
7. Select an experiment in the sidebar to filter the calendar.
8. Click a day to open a larger view of everything scheduled for it.

Calendars and experiments must be archived before they can be permanently deleted. Archiving is reversible and leaves their contents intact. Permanent deletion still asks for confirmation and removes the tasks inside; tasks themselves can be deleted directly.

## Your data

Desktop data is stored at:

```text
~/Library/Application Support/Experiment Planner/experiment-planner.sqlite
```

Before changing the database format, the app creates and verifies a restorable backup beside the database. It keeps the three newest migration backups. See [Data recovery](docs/data-recovery.md) if an upgrade cannot start.

Local databases, tasks, calendars, database backups, build output, and installation packages are excluded from this repository.

## Run from source

Requirements: Node.js 22.12 or newer and npm.

```bash
npm install
npm run desktop:run
```

To run the browser development version instead:

```bash
npm install
npm run dev
```

Then open [http://127.0.0.1:5173](http://127.0.0.1:5173).

## Development checks

```bash
npm test
npm run build
npm run desktop:typecheck
```
