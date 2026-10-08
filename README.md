# Daily Tracker

A tap-to-tick version of the monthly habit sheet for a wall or coffee-table tablet. Tasks down the left, days across the top, with sleep and mood plots underneath. Everything is saved on your server as one small JSON file per month.

## How updates work

Every push to `main` runs a GitHub Action that checks the code, builds a Docker image and publishes it to `ghcr.io/jrhattigan1/daily-tracker`. On ZimaOS, a small updater container (a maintained fork of Watchtower) checks for a newer image every night at 03:00, pulls it and restarts the tracker. It only touches containers labelled for it, so nothing else on the server is affected.

The page asks the server for its version every few minutes and reloads itself when it changes, so the tablet picks up the new version on its own. It won't reload while you're typing or mid-save.

Your data lives in `/DATA/AppData/daily-tracker/data` and is never part of the image, so updates don't touch it.

## Install on ZimaOS

The image needs to be public so ZimaOS can pull it without logging in. After the first build, go to your GitHub profile, Packages, `daily-tracker`, Package settings, and set visibility to Public. There's no personal data in it, only the code.

Moving from the earlier file-based install:

1. Back up `/DATA/AppData/daily-tracker/data` using the ZimaOS Files app.
2. Uninstall the old Daily Tracker app from the dashboard. If it offers to delete app data, say no.
3. On the dashboard, open the App Store, choose "Install a customized app", then Import, then the Docker Compose tab.
4. Paste the contents of `zimaos-compose.yml` and install. It creates two containers: the tracker and its updater.
5. Open `http://<zimaos-ip>:8090` on the tablet. Your existing months should all be there.

The old `server.py` and `public` folder in `/DATA/AppData/daily-tracker` can be deleted once it's working. Only the `data` folder is used now.

To update straight away rather than waiting for 03:00, restart the updater container from the dashboard.

## Rolling back

Every build is also tagged with its commit, for example `sha-1a2b3c4`, listed under the package on GitHub. To go back, change `:latest` in the compose file to that tag and redeploy. The updater leaves a pinned tag alone. Switch back to `:latest` once the fix is in.

## Run it without Docker

Any machine with Python 3.9 or newer:

```
python3 server.py
```

It listens on port 8080 and stores data in `./data`. Set `PORT` or `DATA_DIR` to change either. `docker-compose.yml` builds and runs it locally if you want to test changes before pushing.

## Using it

- Tap a square to tick it, tap again to clear it.
- Tap a task name to type or edit it. A new month starts with last month's task names.
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

## Settings

The top of `public/app.js` has a few values you can change: the minimum number of task rows, the sleep range and the sleep target.

## Security

There's no login. It's meant for your home network only. Don't forward the port to the internet. If you want to reach it from outside, go through a VPN such as Tailscale or WireGuard.

The updater has access to the Docker socket, which is how it restarts containers. That's normal for this kind of tool, and it's limited to labelled containers here.

## Backups

Copy the `data` folder. Each month is a readable JSON file, for example `2026-11.json`.
