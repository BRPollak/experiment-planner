# Data recovery

Experiment Planner creates a verified SQLite backup before it upgrades an existing database. Backup names begin with:

```text
experiment-planner.sqlite.pre-migration-
```

The app keeps the three newest migration backups in:

```text
~/Library/Application Support/Experiment Planner/
```

## Restore a backup

1. Quit Experiment Planner completely.
2. In Finder, choose **Go > Go to Folder**, then open `~/Library/Application Support/Experiment Planner/`.
3. Create a folder there named `recovery-original`.
4. Move the current `experiment-planner.sqlite` and any matching `experiment-planner.sqlite-wal` or `experiment-planner.sqlite-shm` files into that folder. Do not delete them.
5. Duplicate the newest `experiment-planner.sqlite.pre-migration-…sqlite` file.
6. Rename the duplicate to `experiment-planner.sqlite`.
7. Open Experiment Planner again.

Keep the moved files until you have confirmed that every calendar, experiment, and task is present. Never replace or copy the database while the app is running.
