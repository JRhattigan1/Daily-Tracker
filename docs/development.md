# Development

[Back to the docs index](README.md)

- [Principles](#principles)
- [Files](#files)
- [Running it locally](#running-it-locally)
- [How the page works](#how-the-page-works)
- [How the server works](#how-the-server-works)
- [Common changes](#common-changes)
- [Releasing](#releasing)
- [Testing](#testing)

## Principles

- **No dependencies and no build step.** The server uses the Python standard library only. The page is plain HTML, CSS and JavaScript loaded straight by the browser. What's in the repo is exactly what runs.
- **The data is the user's.** One readable JSON file per month, never touched by updates, and older formats keep loading.
- **Both layouts are first class.** Anything added to the month sheet needs a portrait equivalent.

## Files

```
.
├── server.py               the server: web, API, saving and self-updating
├── public/
│   ├── index.html          markup for both layouts, the rest days picker and the task sheet
│   ├── app.js              all page behaviour
│   ├── app.css             all styling, light and dark
│   ├── manifest.webmanifest, icon.svg, icon-*.png   home screen icons
├── zimaos-compose.yml      the compose file for ZimaOS and other Docker hosts
├── docs/                   these docs
└── .github/workflows/check.yml   compiles server.py and checks app.js on every push
```

Only `server.py` and `public/` are installed by the updater. Everything else stays in the repo.

## Running it locally

```
git clone https://github.com/JRhattigan1/Daily-Tracker.git
cd Daily-Tracker
python3 server.py
```

Open `http://localhost:8080`. Data goes in `./data`, which is ignored by git.

Self-updating is off automatically in a git checkout, so the server won't overwrite your changes with what's on GitHub. The page fetches its fonts from Google Fonts. Without internet it falls back to system fonts.

To check the portrait layout, narrow the browser window below 900 px or use the browser's device toolbar.

## How the page works

`public/app.js` is one script, roughly in this order:

1. **Settings.** `CFG` holds the user-adjustable values. `PLOTS` defines the three plots (see [adding a plot](#adding-a-plot)).
2. **Layout detection.** `PORTRAIT_MQ` is a media query for portrait, narrow or short screens. When it matches, the `<html>` element gets the class `m` and the portrait layout is drawn. It's re-evaluated live on rotate or resize.
3. **Data.** `normalise()` turns whatever is loaded (including older formats) into the current shape. `isDone()`, `isDue()`, `countDone()` and `countDue()` are the basic questions everything else asks.
4. **Chains.** `chainInfo()` works out, for each day of a task, whether it links to the previous completed day (`jl`), the next (`jr`), or sits on a rest day a chain runs through (`thru`). CSS draws the links from those classes.
5. **Loading and saving.** `load()` fetches a month. `changed()` puts the month in a save queue and keeps a copy in the browser's local storage. `flush()` sends the queue and retries every 5 seconds on failure.
6. **Rendering.** `render()` draws the month sheet, or calls `renderMobile()` for portrait. `paintRow()` repaints one task's row after a tap without redrawing everything. `drawPlot()` draws the sheet-layout plots and `drawMobilePlot()` the portrait ones, both as SVG.
7. **Interaction.** Taps on squares go through `tapCell()`. Times per day and rest days go through `setTarget()`, `toggleDue()` and `presetDue()`, shared by the sheet layout's pills and picker and the portrait task sheet.
8. **Background jobs.** Midnight rollover, refreshing from the server every 5 minutes when idle, and reloading when the server version changes. `idle()` decides when it's safe to do these without getting in the user's way.

Styling notes:

- Colours are CSS custom properties on `:root`, redefined for dark mode both for `prefers-color-scheme` and for the theme button's forced choice. Use the tokens rather than new colours.
- Squares size themselves from their cell using container query units (`cqw`, `cqh`) through the `--sq` variable. Chain links are positioned from the same values, by layout rather than transforms, so they meet the squares exactly.
- Everything for the portrait layout is under `html.m`.

## How the server works

`server.py` has four parts:

- **Settings** from environment variables (see [Configuration](configuration.md)).
- **Self-update.** `latest_commit()` asks GitHub for the commit at `UPDATE_REF`. `install_commit()` downloads, checks and stages a new version, and `swap_in()` replaces `server.py` and `public/` under the same lock used for saves. After a successful install the server shuts down its listener and replaces itself with `os.execv`, so it restarts in place under Docker, systemd or a terminal alike. See [Updates](updates.md).
- **Data.** One file per month, written atomically. `latest_task_templates()` supplies the task list for a new month.
- **Web.** A `ThreadingHTTPServer` serving `public/` and the API. The page and API are sent with `Cache-Control: no-store`, so a browser never runs a stale version.

It handles `SIGTERM` so Docker can stop it instantly. Without that, Python running as process 1 in a container ignores the stop signal and Docker has to wait 10 seconds and kill it.

## Common changes

### Changing a range or target

Edit `CFG` at the top of `app.js`. See [Configuration](configuration.md#page-settings).

### Adding a plot

1. Add an entry to `PLOTS` in `app.js`:

   ```js
   water: {
     id: 'waterSvg', axis: 'waterAxis',
     top: 3, bottom: 0, unit: 0.5, step: 0.25, target: 2,
     label: (v) => (v % 1 === 0 ? `${v}L` : ''),
   },
   ```

   `top` and `bottom` are the range, `unit` is the gap between rows of dots, `step` is what a tap snaps to, `target` draws a dashed line (or `null` for none), and `label` gives each row's axis text (an empty string skips a row). The month data automatically gets a 31-day list with the same name.

2. In `index.html`, add a `<section class="plot">` for the month sheet with an `<svg id="waterSvg" class="psvg">` and a `<div id="waterAxis" class="axis">`, copying the steps section. Add a `data-tab="water"` button to `.mtabs` for portrait.

3. In `app.css`, add a row for it to `.page`'s `grid-template-rows`.

4. Optionally add an average to the footer: a `<div class="stat">` in `index.html` and a line in `updateStats()`.

5. Add `'water'` to the list of tabs `mTab` accepts near the top of `app.js`.

### Changing the data format

Add fields rather than renaming or removing them, and give every new field a default in `normalise()` so older months still load. If the server needs to carry a field into new months, add it to `latest_task_templates()` too. Document it in [Data and API](data-and-api.md).

## Releasing

Push to `main`. The Check workflow compiles `server.py`, loads it, and checks `app.js` for syntax errors. Installed trackers pick the change up at their next nightly check, or within 20 seconds if restarted. Each install also runs its own checks before switching over (see [Updates](updates.md#what-happens-during-an-update)).

If a release goes wrong, push a fix or revert. Anyone affected can pin the last good commit with `UPDATE_REF` in the meantime.

## Testing

There's no test suite in the repo yet. Changes so far have been tested by:

- **The updater:** running the server with `GITHUB_API` pointing at a small local fake of GitHub's API and `UPDATE_START_DELAY=1`. That covers a fresh install upgrading, staying up to date, and rejecting a broken commit while keeping the current version.
- **The page:** driving it in a headless browser (Playwright) at tablet, phone, portrait tablet and desktop sizes, tapping squares, pills, plots and sheets. Then checking what was saved and taking screenshots in both themes.

Before pushing a page change, it's worth checking at least a landscape tablet size (1180 × 820), a phone (390 × 844) and both themes.
