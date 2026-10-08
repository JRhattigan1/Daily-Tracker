# Installation

[Back to the docs index](README.md)

- [What you need](#what-you-need)
- [ZimaOS](#zimaos)
- [Other Docker hosts](#other-docker-hosts)
- [Without Docker](#without-docker)
- [Setting up the tablet](#setting-up-the-tablet)
- [Phones](#phones)
- [Home Assistant](#home-assistant)
- [Reaching it from outside the house](#reaching-it-from-outside-the-house)

## What you need

- A machine on your home network that's always on, with Docker or Python 3.9 or newer.
- Internet access from that machine, if you want automatic updates (see [Updates](updates.md)).
- A browser on the tablet or phone. Any current Safari, Chrome, Firefox or Edge works.

The app itself is tiny: a few MB of RAM, and its data is a few KB per month.

## ZimaOS

This runs the stock `python:3.12-alpine` image straight from a folder on your server, so there's nothing to build.

1. **Copy the files.** In the ZimaOS Files app, create `/DATA/AppData/daily-tracker` and upload `server.py` and the `public` folder from this repo into it. `server.py` should sit directly inside `daily-tracker`, not in a subfolder.

   ```
   /DATA/AppData/daily-tracker/
   ├── server.py
   └── public/
   ```

2. **Import the app.** On the dashboard, open the App Store, choose **Install a customized app**, then **Import**, then the **Docker Compose** tab.

3. **Paste and install.** Paste the contents of [`zimaos-compose.yml`](../zimaos-compose.yml), check that the port is 8090 and the volume points at the folder above, then install.

   ```yaml
   name: daily-tracker
   services:
     daily-tracker:
       image: python:3.12-alpine
       container_name: daily-tracker
       restart: unless-stopped
       working_dir: /app
       command: ["python", "server.py"]
       environment:
         - DATA_DIR=/app/data
         - PORT=8080
         - TZ=Europe/London
         - PYTHONUNBUFFERED=1
       ports:
         - "8090:8080"
       volumes:
         - /DATA/AppData/daily-tracker:/app
   ```

4. **Open it.** On the tablet, go to `http://<zimaos-ip>:8090`.

About 20 seconds after it first starts, it checks GitHub and pulls in the latest version. From then on it updates itself overnight. Your data is saved in `/DATA/AppData/daily-tracker/data`.

If the import fails, it's almost always the YAML getting mangled on paste. Notes apps in particular can turn indentation into tabs. Copy it from a plain text editor and use spaces only.

To use a different port, change the left-hand number in `"8090:8080"`.

## Other Docker hosts

The same compose file works anywhere. Change the volume to wherever you put the files, for example `./daily-tracker:/app`, then run:

```
docker compose -f zimaos-compose.yml up -d
```

## Without Docker

On any machine with Python 3.9 or newer:

```
python3 server.py
```

It listens on port 8080 and saves data in `./data`. To change either, set `PORT` or `DATA_DIR` (see [Configuration](configuration.md)).

To keep it running and start it at boot, a systemd service works well:

```ini
# /etc/systemd/system/daily-tracker.service
[Unit]
Description=Daily Tracker
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/daily-tracker
ExecStart=/usr/bin/python3 server.py
Environment=PORT=8090
Restart=always

[Install]
WantedBy=multi-user.target
```

```
sudo systemctl daemon-reload
sudo systemctl enable --now daily-tracker
```

Self-updating works the same way here. The process replaces itself when it installs an update, so the service carries on without systemd needing to restart it.

If you run it from a `git clone` of this repo, self-updating is switched off automatically so it never overwrites your working copy. See [Development](development.md).

## Setting up the tablet

**Android.** [Fully Kiosk Browser](https://www.fully-kiosk.com) is the usual choice for a wall or coffee-table tablet:

- Set the start URL to `http://<server-ip>:8090`.
- Turn on **Keep screen on**.
- Optionally use motion detection to wake the screen when someone walks past.

**iPad.**

- Open the page in Safari, tap Share, then **Add to Home Screen**. It then opens full screen without the address bar.
- **Settings > Accessibility > Guided Access** locks the iPad to the tracker.
- **Settings > Display & Brightness > Auto-Lock** controls when the screen sleeps.

Landscape gives you the full month sheet. Portrait gives the [portrait layout](user-guide.md#two-layouts).

## Phones

Open `http://<server-ip>:8090` while you're on your home Wi-Fi. You get the portrait layout automatically.

- **iPhone:** **Add to Home Screen** in Safari gives it an icon and opens it full screen.
- **Android:** **Add to Home screen** in Chrome's menu gives it an icon. Because it's served over plain HTTP, Chrome opens it as a normal tab rather than a full-screen app.

## Home Assistant

You can show the tracker on a Home Assistant dashboard with a **Webpage** card pointing at `http://<server-ip>:8090`.

If you open Home Assistant over HTTPS, the browser blocks an HTTP page inside it. Either open the tracker directly instead of through HA, or put the tracker behind the same reverse proxy as HA so it's served over HTTPS too.

## Reaching it from outside the house

There's no login, so **don't forward the port to the internet**. To use it away from home, go through a VPN such as [Tailscale](https://tailscale.com) or WireGuard and open the same address over the VPN.
