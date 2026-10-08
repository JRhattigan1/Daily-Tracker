# Troubleshooting

[Back to the docs index](README.md)

- [The page won't load](#the-page-wont-load)
- [Not saved, retrying](#not-saved-retrying)
- [Offline, showing this tablet's copy](#offline-showing-this-tablets-copy)
- [It isn't updating](#it-isnt-updating)
- [The tablet is still on the old version](#the-tablet-is-still-on-the-old-version)
- [Today is the wrong day](#today-is-the-wrong-day)
- [Changes on one device don't show on another](#changes-on-one-device-dont-show-on-another)
- [Home Assistant shows a blank card](#home-assistant-shows-a-blank-card)
- [The fonts look different](#the-fonts-look-different)
- [Restoring data](#restoring-data)

## The page won't load

1. Check the app is running in the ZimaOS dashboard. Look at its logs. A healthy start logs a line like `Daily Tracker 8b848d7 on http://0.0.0.0:8080`.
2. Check the address and port: `http://<server-ip>:8090` with the standard compose file.
3. Check `server.py` and the `public` folder are directly inside `/DATA/AppData/daily-tracker`, not in a subfolder. The log shows a Python error if `server.py` can't be found.
4. Open `http://<server-ip>:8090/api/health`. If that returns `{"ok": true, ...}` but the page is blank, the `public` folder is missing or incomplete.

## Not saved, retrying

The page can't reach the server. Your changes are held while the page stays open, and it retries every 5 seconds. It usually means the server is restarting (for example during an update, which takes about a second), the app has stopped, or the tablet has dropped off Wi-Fi.

## Offline, showing this tablet's copy

The page couldn't load the month from the server, so it's showing the copy the device saved last time. Once the server is back, refresh the page.

## It isn't updating

Open `http://<server-ip>:8090/api/version` and look at `status` (see [Updates](updates.md#seeing-what-it-did)):

- **`could not check GitHub`:** the server can't reach GitHub. Check the server has internet access. If the repo has been made private, add a `GITHUB_TOKEN` (see [Updates](updates.md#private-repo)).
- **`update ... failed, kept current version`:** the new version didn't pass its checks, so it stayed on the working one. The message says why. It'll try again at the next check, so a fix pushed to GitHub gets picked up automatically.
- **`up to date`:** it's already on the latest commit.
- **`"enabled": false`:** `AUTO_UPDATE` is set to `0`, or it's running from a git checkout.

Also check `UPDATE_REF` isn't set to a pinned commit.

To check now rather than overnight, restart the app.

## The tablet is still on the old version

The page reloads itself within a few minutes of an update, but only when you're not in the middle of something: no unsaved changes, no text field being edited, and no picker or sheet open. Tapping somewhere neutral, or locking and unlocking the tablet, usually lets it go ahead.

If you've just moved over to the self-updating version for the first time, refresh the tablet once by hand.

## Today is the wrong day

"Today" comes from the clock on the tablet or phone, not the server. Check its date, time and time zone.

The server's own clock is UTC, which only affects log timestamps and when the nightly update check runs.

## Changes on one device don't show on another

Open pages pick up changes from other devices every 5 minutes, and straight away when you switch back to the page. If a device is mid-edit, it waits so it doesn't throw away what you're typing. Refresh to see changes immediately.

If two devices change the same month at almost the same moment, the last one to save wins.

## Home Assistant shows a blank card

If Home Assistant is opened over HTTPS, browsers block an HTTP page inside it. Open the tracker directly, or serve it over HTTPS behind the same reverse proxy as HA. See [Installation](installation.md#home-assistant).

## The fonts look different

The page loads its fonts (IBM Plex) from Google Fonts. Without internet access on the tablet, it falls back to the device's own fonts. Everything still works.

## Restoring data

Each month is a file in the `data` folder, for example `2026-10.json`. To restore from a backup, copy the files back into `data` and refresh the page. To undo a single month, restore just that file.
