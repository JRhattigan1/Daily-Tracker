# Configuration

[Back to the docs index](README.md)

There are two kinds of settings. Server settings are environment variables, set in the app's settings on ZimaOS or in the compose file. Page settings are a few values at the top of `public/app.js`.

## Server settings

All are optional.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8080` | Port the server listens on inside the container. The compose file maps it to 8090 on your server |
| `HOST` | `0.0.0.0` | Address to listen on. Leave as is to accept connections from your network |
| `DATA_DIR` | `./data` | Folder for the month files. The ZimaOS compose sets it to `/app/data` |
| `AUTO_UPDATE` | on | Set to `0` to stop it updating itself. Always off in a git checkout unless set to `1` |
| `UPDATE_REF` | `main` | Branch, tag or commit to follow. Set a commit to pin a version |
| `UPDATE_HOUR` | `3` | Hour of the nightly update check, in the container's clock. It checks at 7 minutes past |
| `UPDATE_REPO` | `JRhattigan1/Daily-Tracker` | GitHub repo to update from, as `owner/name` |
| `GITHUB_TOKEN` | none | Read-only token, only needed if the repo is private |

There are also two settings used for testing the updater: `GITHUB_API`, the address of the GitHub API, and `UPDATE_START_DELAY`, the seconds to wait after starting before the first check (20 by default). You won't normally need either.

**Time zones.** The `python:3.12-alpine` image doesn't include timezone data, so the server's clock, its log timestamps and `UPDATE_HOUR` are all in UTC whatever `TZ` says. This only affects when the nightly check runs. Everything to do with days, like which day is today, weekends and midnight rollover, comes from the clock on the tablet or phone you're using.

After changing a variable, restart the app.

## Page settings

These are at the top of `public/app.js`:

```js
const CFG = {
  taskRows: 8,          // minimum number of task rows shown
  sleepMin: 3,          // lowest hour on the sleep plot
  sleepMax: 11,         // highest hour on the sleep plot
  sleepTarget: 8,       // highlighted with a dashed line
  stepsMax: 16000,      // top of the steps plot
  stepsTarget: 10000,   // highlighted with a dashed line
  maxTarget: 6,         // most times per day a task can be set to
};
```

| Setting | Notes |
|---|---|
| `taskRows` | The month sheet always shows at least this many rows, so there's room to add tasks. More tasks than this still show |
| `sleepMin`, `sleepMax` | Whole hours. The plot gets one row of dots per hour |
| `sleepTarget` | The hour marked with a dashed line and highlighted on the axis |
| `stepsMax` | Top of the steps plot. Rows of dots are every 2,000 steps, so keep this a multiple of 2,000 |
| `stepsTarget` | The steps value marked with a dashed line. It's highlighted on the axis if it lands on a row, so a multiple of 2,000 works best |
| `maxTarget` | Highest times per day a task can be set to |

These are part of the code, so a change here is a change to the app. Make it in the repo on GitHub and it rolls out like any other update. If you edit the file on your server instead, the next update will overwrite it.

## Port and address

The tracker is at `http://<server-ip>:8090` with the standard compose file. To change the outside port, edit the left-hand number in `"8090:8080"` in the compose file and redeploy.
