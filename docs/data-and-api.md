# Data and API

[Back to the docs index](README.md)

- [Where your data lives](#where-your-data-lives)
- [Backups](#backups)
- [The month file](#the-month-file)
- [Older files](#older-files)
- [HTTP API](#http-api)

## Where your data lives

Everything is in the `data` folder next to `server.py`, which on ZimaOS is `/DATA/AppData/daily-tracker/data`. There's one file per month, named by year and month:

```
data/
├── 2026-09.json
├── 2026-10.json
└── 2026-11.json
```

A file is created the first time anything is changed in that month. Saves are atomic: the server writes a temporary file and swaps it in, so a power cut mid-save can't leave a half-written month.

Updates never touch this folder.

## Backups

Copy the `data` folder. That's everything. To restore, put the files back and refresh the page.

Each file is plain JSON, so you can open it in any text editor, and you could load it into a spreadsheet or a script for your own analysis.

## The month file

```json
{
  "tasks": [
    {
      "name": "Brush teeth",
      "target": 2,
      "schedule": [true, true, true, true, true, true, true],
      "days": [2, 2, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    },
    {
      "name": "Gym",
      "target": 1,
      "schedule": [false, true, false, true, false, true, false],
      "days": [0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    }
  ],
  "sleep": [7.5, 6.5, 8, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  "steps": [9500, 12000, 4000, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  "mood": [4, 3, 5, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  "focus": "In bed by 11 on work nights",
  "notes": ""
}
```

Every per-day list has 31 entries, one per day of the month starting from the 1st. Entries past the end of a shorter month are unused.

| Field | Type | Meaning |
|---|---|---|
| `tasks` | list | One entry per task row, in order. Rows with an empty name are blank rows |
| `tasks[].name` | text | The task's name |
| `tasks[].target` | whole number, 1 to 6 | Times per day for the task to count as done |
| `tasks[].schedule` | 7 true/false values | Which weekdays it's due, **starting with Sunday**: Sun, Mon, Tue, Wed, Thu, Fri, Sat. `false` is a rest day |
| `tasks[].days` | 31 whole numbers | How many times it was done each day. A day is done when this reaches `target` |
| `sleep` | 31 numbers or `null` | Hours, in half hours |
| `steps` | 31 numbers or `null` | Steps, in steps of 500 |
| `mood` | 31 numbers or `null` | 1 Rough, 2 Low, 3 Okay, 4 Good, 5 Great |
| `focus` | text | Focus this month |
| `notes` | text | Notes |

`null` means no value for that day.

## Older files

Months saved by earlier versions still load. Anything missing gets a default when the month is opened, and is saved in the current format the next time you change something:

- `days` holding `true`/`false` instead of counts: `true` becomes done.
- No `target`: 1 time per day.
- No `schedule`: due every day.
- No `steps`: empty.

## HTTP API

The page talks to the server through a small JSON API. You can use it yourself, for example from a script or a Home Assistant automation. There's no authentication, so it's for your home network only.

### `GET /api/month/YYYY-MM`

Returns a month.

If the month has been saved:

```json
{ "exists": true, "data": { "tasks": [...], "sleep": [...], ... } }
```

If it hasn't, the server suggests the task list for a new month, taken from the most recent earlier month with named tasks:

```json
{
  "exists": false,
  "tasks": ["Brush teeth", "Gym"],
  "templates": [
    { "name": "Brush teeth", "target": 2, "schedule": [true, true, true, true, true, true, true] },
    { "name": "Gym", "target": 1, "schedule": [false, true, false, true, false, true, false] }
  ]
}
```

### `PUT /api/month/YYYY-MM`

Saves a whole month. The body is the month file as JSON, up to 256 KB. Replies `{"ok": true}`.

The server stores whatever object you send. The page tidies up anything unexpected when it loads the month, but it's best to send the format above.

Errors come back as JSON with an `error` message: 400 for a body that isn't a JSON object, 413 for an empty or oversized body, 404 for a bad path.

### `GET /api/version`

The running version and what the updater last did. See [Updates](updates.md#seeing-what-it-did).

### `GET /api/health`

`{"ok": true, "version": "..."}`. Handy for a monitoring check or an uptime sensor in Home Assistant.

### Example: ticking a task from a script

This adds one tick to "Brush teeth" on the 8th of October. It assumes October has already been saved at least once.

```python
import json, urllib.request

base = "http://192.168.1.50:8090/api/month/2026-10"
month = json.load(urllib.request.urlopen(base))["data"]

task = next(t for t in month["tasks"] if t["name"] == "Brush teeth")
day = 8                                   # the 8th
task["days"][day - 1] = min(task["days"][day - 1] + 1, task["target"])

req = urllib.request.Request(base, data=json.dumps(month).encode(), method="PUT",
                             headers={"Content-Type": "application/json"})
urllib.request.urlopen(req)
```

A page that's open picks the change up within a few minutes, or straight away when you next come back to it.
