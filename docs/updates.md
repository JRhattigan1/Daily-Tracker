# Updates

[Back to the docs index](README.md)

- [How it works](#how-it-works)
- [When it checks](#when-it-checks)
- [What happens during an update](#what-happens-during-an-update)
- [The tablet catching up](#the-tablet-catching-up)
- [Seeing what it did](#seeing-what-it-did)
- [Updating straight away](#updating-straight-away)
- [Pinning a version and rolling back](#pinning-a-version-and-rolling-back)
- [Turning it off](#turning-it-off)
- [Private repo](#private-repo)

## How it works

The tracker keeps itself up to date from this GitHub repo. There's no image registry and no separate updater container: the server checks GitHub itself, downloads new versions, checks them and swaps them in.

Changes reach you like this:

1. A change is pushed to `main` on GitHub. A small GitHub Actions check makes sure it compiles.
2. The server finds the new commit at its next check.
3. It installs it and restarts itself, which takes about a second.
4. The tablet notices the new version and reloads.

Your `data` folder is never part of an update and is never touched.

## When it checks

- **About 20 seconds after it starts.** This is also how a fresh install pulls in the latest version.
- **Every night at 03:07.** The container has no timezone data, so this is 03:07 UTC, which is 04:07 in summer in the UK.

Each check is one small request to GitHub's API.

## What happens during an update

1. It downloads the new commit as an archive from GitHub.
2. It checks the new version before going anywhere near the live files:
   - `server.py`, `public/index.html`, `public/app.js` and `public/app.css` are all present.
   - `server.py` compiles.
   - `server.py` loads without errors, in a separate process with a throwaway data folder.
3. If any check fails, it keeps running the current version and logs why. It tries again at the next check.
4. If everything passes, it copies the current `server.py` and `public` folder to `.previous`, as a backup.
5. It waits for any save in progress to finish, then swaps in the new `server.py` and `public` folder and records the commit in `.version`.
6. It restarts itself in place on the new code.

Only `server.py` and the `public` folder are ever replaced. Anything else in the repo, like these docs, isn't copied to your server.

## The tablet catching up

The page asks the server for its version every few minutes and whenever you come back to it. When the version changes, it reloads itself so you're on the new page.

It waits until you're not in the middle of something. It won't reload while there are unsaved changes, while you're typing, dragging across a plot, or have the rest days picker or a task sheet open.

The very first time you move to the self-updating version, refresh the tablet once by hand. The page it was showing before didn't know how to reload itself.

## Seeing what it did

Open `http://<server-ip>:8090/api/version`:

```json
{
  "version": "8b848d7",
  "update": {
    "enabled": true,
    "repo": "JRhattigan1/Daily-Tracker",
    "ref": "main",
    "last_check": "2026-10-09 03:07:02",
    "status": "up to date"
  }
}
```

`version` is the installed commit. If it starts with `local-`, the files weren't installed by the updater, for example a first install before its first check.

`status` is one of:

| Status | Meaning |
|---|---|
| `not checked yet` | It started less than about 20 seconds ago |
| `up to date` | It's on the latest commit |
| `updated to abc1234, restarting` | It just installed a new version |
| `update to abc1234 failed, kept current version: ...` | The new version didn't pass its checks. The reason follows |
| `could not check GitHub: ...` | No internet, GitHub unreachable, or the repo is private without a token |

The same messages appear in the app's logs on ZimaOS, with timestamps.

## Updating straight away

Restart the app from the ZimaOS dashboard, or restart the service. It checks about 20 seconds after starting.

## Pinning a version and rolling back

To stay on a particular version, set the `UPDATE_REF` environment variable to a commit from the [commit history](https://github.com/JRhattigan1/Daily-Tracker/commits/main), then restart the app. It installs that commit and stays on it.

To go back to following the latest version, remove `UPDATE_REF` (or set it to `main`) and restart.

`UPDATE_REF` also accepts a branch or tag name, if you ever want to follow something other than `main`.

The previous version is kept in `.previous` inside the app folder, in case you ever need to copy it back by hand.

## Turning it off

Set `AUTO_UPDATE=0` and restart. It then never checks GitHub.

Self-updating is always off when the server runs from a `git clone` of the repo, so a development copy is never overwritten. Set `AUTO_UPDATE=1` to force it on anyway.

## Private repo

The updater reads the repo without logging in, so it needs the repo to be public. There's no personal data in the repo, only code. Your entries stay on your server.

To keep the repo private instead:

1. On GitHub, create a fine-grained personal access token with read-only access to **Contents** on this repo only.
2. Add it to the app as a `GITHUB_TOKEN` environment variable on ZimaOS.
3. Restart the app.
