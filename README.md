# Daily Tracker

A tap-to-tick version of the monthly habit sheet for a wall or coffee-table tablet. Tasks down the left, days across the top, with sleep and mood plots underneath. Everything is saved on your server as one small JSON file per month.

It's one Python file and a folder of web files, standard library only, nothing to install.

## How updates work

The tracker keeps itself up to date from this GitHub repo. About 20 seconds after it starts, and again every night at around 03:00, it asks GitHub for the latest commit on `main`. If there's a new one it:

1. downloads it,
2. checks the new version compiles and loads, and that all the page files are present,
3. keeps the current version in `.previous`,
4. swaps in the new `server.py` and `public` folder, then restarts itself.

If any check fails it keeps running the current version and tries again the next night. The `data` folder is never touched.

The page asks the server for its version every few minutes and reloads itself when it changes, so the tablet follows along. It won't reload while you're typing or mid-save.

To update straight away rather than waiting for the night, restart the app from the ZimaOS dashboard.

You can see what the updater last did at `http://<server-ip>:8090/api/version`, and in the app's logs on ZimaOS.

The repo needs to be public for this to work without a login. There's no personal data in it, only code. If you'd rather keep it private, create a fine-grained GitHub token with read-only access to Contents on this repo, and add it as a `GITHUB_TOKEN` environment variable in the app's settings on ZimaOS.

## Install on ZimaOS

1. In the ZimaOS Files app, create the folder `/DATA/AppData/daily-tracker` and upload `server.py` and the `public` folder into it.
2. On the dashboard, open the App Store, choose "Install a customized app", then Import, then the Docker Compose tab.
3. Paste the contents of `zimaos-compose.yml` and install.
4. Open `http://<zimaos-ip>:8090` on the tablet.

It runs on the stock `python:3.12-alpine` image straight from that folder. Your data is saved in `/DATA/AppData/daily-tracker/data`.

## Settings

Set these as environment variables in the app's settings on ZimaOS. All are optional.

| Variable | Default | What it does |
|---|---|---|
| `AUTO_UPDATE` | on | Set to `0` to turn self-updating off. It's always off when running from a git checkout, so a development copy is never overwritten. |
| `UPDATE_REF` | `main` | Branch, tag or commit to follow. Set a commit to pin a version. |
| `UPDATE_HOUR` | `3` | Hour of the nightly check. The container has no timezone data, so this is UTC (04:00 in summer). |
| `UPDATE_REPO` | `JRhattigan1/Daily-Tracker` | Repo to update from. |
| `GITHUB_TOKEN` | none | Only needed if the repo is private. |
| `PORT`, `DATA_DIR` | `8080`, `./data` | Where it listens and saves. |

The top of `public/app.js` has a few values for the page itself: the minimum number of task rows, the sleep range and the sleep target.

## Rolling back

Set `UPDATE_REF` to the commit you want (from the repo's commit history) and restart the app. It installs that commit and stays on it. Clear the variable to go back to following `main`.

The previous version is also kept in `.previous` inside the app folder, if you ever need to copy it back by hand.

## Run it without Docker

Any machine with Python 3.9 or newer:

```
python3 server.py
```

It listens on port 8080 and stores data in `./data`.

## Using it

- Tap a square to tick it, tap again to clear it.
- For tasks you do more than once a day, tap the task name and a small ×1 pill appears beside it. Tap the pill to set how many times (up to ×6). Pills of ×2 and up stay visible; ×1 hides again to leave room for the name. Each tap on a square then adds one and fills it partway, and it counts as done once it's full. One more tap clears it. Changing the number keeps days you'd already completed as complete.
- Tap a task name to type or edit it. Very long names end in "..." on narrow screens and show in full while you edit them. A new month starts with last month's task names and times per day.
- On the plots, tap a day at the right height to set sleep or mood, or drag a finger across several days to draw the line in one go. Sleep snaps to the nearest half hour. Tap an existing point again to clear it.
- The arrows beside the month change month. "This month" jumps back.
- Totals, days all done, best streak and averages work themselves out. Days all done and best streak only count days up to today, and only tasks that have a name.
- The theme button cycles Auto, Light and Dark. Auto follows the tablet's setting.

Changes save automatically about half a second after you tap. If the server can't be reached, the tablet keeps a copy and retries every few seconds. The page also checks for changes every few minutes, so edits made on your phone appear on the tablet.

## Setting up the tablet

**Android:** [Fully Kiosk Browser](https://www.fully-kiosk.com) is the usual choice. Set the start URL to the tracker, turn on "Keep screen on", and optionally use motion detection to wake the screen when you walk past.

**iPad:** open the page in Safari, Share, Add to Home Screen. It then opens full screen without the address bar. Settings, Accessibility, Guided Access locks the iPad to it, and Display & Brightness, Auto-Lock controls when the screen sleeps.

## Home Assistant

You can show it on an HA dashboard with a Webpage card pointing at `http://<server-ip>:8090`. If you open HA over HTTPS, the browser will block an HTTP page inside it. Either open the tracker directly on the tablet, or put it behind the same reverse proxy as HA.

## Security

There's no login. It's meant for your home network only. Don't forward the port to the internet. If you want to reach it from outside, go through a VPN such as Tailscale or WireGuard.

The updater only ever downloads from the repo it's set to follow, and only replaces `server.py` and the `public` folder.

## Backups

Copy the `data` folder. Each month is a readable JSON file, for example `2026-11.json`.
