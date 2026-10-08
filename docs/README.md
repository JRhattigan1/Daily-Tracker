# Daily Tracker documentation

Daily Tracker is a self-hosted habit, sleep, steps and mood tracker built for a tablet in the living room, with a phone layout for checking in on the go. It's a digital take on a paper monthly habit grid: the month fills in as you go, and the picture of the whole month is the point.

![The month sheet on a tablet](images/desktop-light.png)

## Guides

| Page | What's in it |
|---|---|
| [User guide](user-guide.md) | Everything the page does: tasks, times per day, rest days, chains, the plots, stats, the month review, celebrations, layouts and saving |
| [Installation](installation.md) | Running it on ZimaOS, other Docker hosts or plain Python, and setting up a tablet or phone |
| [Updates](updates.md) | How it keeps itself up to date from GitHub, pinning a version, rolling back and turning it off |
| [Configuration](configuration.md) | Server settings (environment variables) and page settings |
| [Data and API](data-and-api.md) | Where your data lives, the file format, backups and the HTTP API |
| [Development](development.md) | How the code is laid out, running it locally and making changes |
| [Troubleshooting](troubleshooting.md) | What the status messages mean and how to fix common problems |

## At a glance

- One Python file and a folder of web files. Standard library only, nothing to install, no build step.
- Data is saved on your server as one readable JSON file per month.
- Works on a tablet in landscape, a phone or tablet in portrait, and desktop browsers. The layout switches automatically.
- Updates itself overnight from this repo. Each new version is checked before it goes live, and your data is never touched.
- No accounts or login. It's designed for your home network.
