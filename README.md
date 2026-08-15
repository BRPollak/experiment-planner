# Experiment Planner

Experiment Planner is a private, local-first macOS app for organizing experiments and their tasks on a monthly calendar.

Use separate calendars for different projects, group work into color-coded experiments, and schedule tasks with optional times and notes. Everything is stored locally on your Mac—there are no accounts, cloud services, or external databases.

## Install on macOS

Experiment Planner currently supports Apple silicon Macs running macOS 12 or newer.

1. Open the repository's **Releases** page.
2. Download `Experiment Planner-<version>-arm64.dmg` from the latest release.
3. Open the downloaded DMG.
4. Drag **Experiment Planner** into the **Applications** folder.
5. Open Experiment Planner from Applications.

The app is not currently notarized by Apple. On first launch, macOS may require you to Control-click the app, choose **Open**, and then confirm **Open**.

Installing a newer version does not remove your existing planner data.

## How to use it

1. Create a **calendar** for a project or area of work.
2. Create one or more color-coded **experiments** inside that calendar.
3. Select **Add Task**, or use the plus button on a calendar day.
4. Give the task a date, optional time, experiment, and notes.
5. Click a task to edit it, or drag it to another day to reschedule it.
6. Select an experiment in the sidebar to filter the calendar.
7. Click a day to open a larger view of everything scheduled for it.

Deleting a calendar or experiment also deletes the tasks inside it, so the app asks for confirmation first.

## Your data

Desktop data is stored at:

```text
~/Library/Application Support/Experiment Planner/experiment-planner.sqlite
```

Local databases, tasks, calendars, build output, and installation packages are excluded from this repository.

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
