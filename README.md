# Wifi Detection

A local-only 3D dashboard for discovering every device your computer can see on its LAN. The gateway sits at the centre of the field; each neighbour becomes a glowing node with three measured signal bands, a ground tether, and a live link back to the router.

Built for Windows, Linux, and macOS, with no runtime dependencies, no cloud account, and no build step.

> Screenshots are intentionally not committed. A real capture reveals local hostnames, IP addresses, and MAC addresses.

## Highlights

- **3D device field** — orbit, zoom, inspect nodes and their labels.
- **Signal bands** — three measured arcs per device: **Reach**, **Response**, and **Stability**.
- **Fast discovery** — ARP warm-up, ICMP validation, TCP fallback, service probing, mDNS, SSDP/UPnP, DNS and NetBIOS.
- **Identity** — local IEEE OUI vendor lookup, hostnames, mDNS/Bonjour names, UPnP friendly names, and best-known-name caching.
- **Activity timeline** — persistent joins, meaningful drop-offs, returns, and power-grade changes.
- **Alerts** — in-app toasts, unread badge, and optional desktop notifications.
- **History** — first-seen time, short power trace, and recent events per device.
- **Responsive UI** — full dashboard on desktop, touch-friendly bottom sheet on phones.
- **Privacy-first** — discovery never leaves the LAN. Runtime history is local and git-ignored.

## Requirements

- Node.js 20 or newer
- Windows 10/11, a modern Linux distribution, or macOS 12+
- Platform tools:
  - **Windows** — `ping`, `arp`, `nbtstat`, PowerShell
  - **Linux** — `ping` (`iputils-ping`), `ip` (`iproute2`), and optionally `iw`/`iwgetid` for Wi-Fi details
  - **macOS** — built-in `ping`, `arp`, `route`, `ifconfig`, and `networksetup`

The scanner uses native commands on each platform and falls back gracefully when optional tools are missing. The web UI is plain HTML/CSS/JavaScript and works anywhere.

| Capability | Windows | Linux | macOS |
| --- | --- | --- | --- |
| HTTP server + 3D UI | Yes | Yes | Yes |
| ARP / ICMP / TCP discovery | Yes | Yes | Yes |
| mDNS / SSDP / DNS | Yes | Yes | Yes |
| Vendor lookup (OUI) | Yes | Yes | Yes |
| Wi-Fi adapter SSID/signal | `netsh` | `iw` / `iwgetid` | `networksetup` |
| NetBIOS fallback names | `nbtstat` | DNS/mDNS only | DNS/mDNS only |
| Activity history + alerts | Yes | Yes | Yes |

Windows is the primary tested target; Linux and macOS support uses equivalent native commands but has not been tested on every distribution or OS version.

## Quick start

**Linux / macOS**

```bash
cd wifi-detection
bash start.sh
```

**Windows**

```powershell
cd wifi-detection
npm start
```

Open **<http://127.0.0.1:7373>**.

On Windows, you can also double-click **`Start Wifi Detection.bat`**. On macOS, after `chmod +x "Start Wifi Detection.command"`, you can double-click that file. Both launchers start the server if needed, wait for the health check, and open the browser.

No `npm install` is required — the project has no third-party runtime packages. Three.js is vendored in `public/vendor/`.

The first scan takes roughly 5-10 seconds. Later scans run every 45 seconds and the UI updates live through Server-Sent Events.

## Controls

| Input | Action |
| --- | --- |
| Drag | Orbit the field |
| Scroll / pinch | Zoom |
| Click a node or label | Inspect the device |
| `R` | Rescan now |
| `L` | Toggle labels |
| `Space` | Toggle auto-orbit |
| `/` | Focus device search |
| `Esc` | Close details / device sheet |
| Double-click empty space | Reset the camera |

## The interface

- **Network Path** — adapter, link speed, subnet, gateway, hostname, scan timing.
- **Device Field** — every discovered device, with power and type.
- **Activity** — timeline of joins, returns, drop-offs, and power-band changes. Filter by **All / Joined / Left / Power**.
- **Device detail** — power gauge, three bands, latency, jitter, loss, services, power trace, and recent activity.
- **Alerts** — the bell button inside the Activity tab enables browser desktop notifications. In-app toasts and the unread badge work without permission.

## How it works

1. **ARP warm-up** — sends a tiny UDP datagram to every address in the local subnet. The OS resolves live hosts through ARP even if their firewall drops the packet.
2. **Neighbour table** — reads `arp -a`, ignoring multicast, broadcast, and incomplete entries.
3. **Validation** — one ICMP ping per candidate. If ICMP is filtered, a short TCP liveness pass decides whether the host is online or just a stale ARP entry.
4. **Identity** — reverse DNS, mDNS reverse-PTR queries, conditional NetBIOS, local OUI lookup, SSDP M-SEARCH (multicast plus unicast), and UPnP description XML.
5. **Metrics** — three parallel single-packet pings (latency, loss, jitter) and a TCP service scan.
6. **Activity** — compares the current sweep with the persisted presence map. A single missed sweep is treated as a Wi-Fi blip; drop alerts require two consecutive offline sweeps. Repeated alerts for the same device/type have a five-minute cooldown.
7. **Persistence** — names, first-seen times, services, short power histories, presence, and the activity timeline are written to a local history file.

### About the signal bands

Operating systems do not expose router-side, per-device Wi-Fi RSSI to normal user-space programs. The bands therefore visualise **measured link quality**, not a fabricated signal number:

| Band | Measured from |
| --- | --- |
| **Reach** | Packet loss (`100 - loss`) |
| **Response** | Round-trip latency |
| **Stability** | Jitter across a ping burst |

Overall power is a weighted blend of the three. A distant phone with high latency and jitter genuinely gets a smaller, hotter band than a wired gateway. If the host is on Wi-Fi, its own adapter SSID/signal is shown in the sidebar, but per-device RSSI remains a router-side value.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `7373` | First port to try; the server increments if it is busy |
| `SCAN_INTERVAL_MS` | `45000` | Delay between automatic sweeps (minimum 15 s) |
| `HISTORY_PATH` | `data/history.json` | Override the runtime history file location |

Example:

```powershell
$env:PORT = "8080"
$env:SCAN_INTERVAL_MS = "60000"
$env:HISTORY_PATH = "D:\temp\wifi-detection-history.json"
npm start
```

Use `HISTORY_PATH` if you want to keep local scan history outside the repository.

## API

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/state` | GET | Network info, device list, scan metadata, progress, activity count |
| `/api/history?limit=160` | GET | Persisted activity events, sweep count, latest event |
| `/api/events` | GET | Server-Sent Events: `state`, `progress`, `scan`, `alert` |
| `/api/scan` | POST | Request an immediate sweep |
| `/api/health` | GET | Lightweight liveness and device count |

## Project structure

```text
wifi-detection/
├─ server.mjs                HTTP server, SSE hub, scan scheduler, gzip static serving
├─ lib/
│  └─ scanner.mjs            ARP / ICMP / TCP / mDNS / SSDP / DNS / NetBIOS scanner
├─ public/
│  ├─ index.html             HUD and 3D stage
│  ├─ styles.css             Visual system and responsive layout
│  ├─ app.js                 Three.js scene, labels, timeline, alerts
│  └─ vendor/                Pinned Three.js modules
├─ data/
│  └─ oui.json               Public IEEE OUI-to-vendor table (generated)
├─ scripts/
│  ├─ scan-once.mjs          Run one scan and print JSON
│  └─ build-oui.mjs          Rebuild data/oui.json from IEEE
├─ Start Wifi Detection.bat
├─ Start Wifi Detection.command
├─ Start.ps1
├─ start.sh
├─ package.json
└─ README.md
```

`data/history.json` is created at runtime and is intentionally ignored by Git. It contains local device names, IPs, MAC addresses, and activity events. Delete it to start with a clean history.

## Development

Run a single scan and inspect the JSON:

```powershell
npm run scan
```

Rebuild the vendor table from the public IEEE registry:

```powershell
node scripts/build-oui.mjs
```

The dashboard has no bundler and no build output. Edit files under `public/` and refresh.

## Privacy

- All discovery traffic stays on the local network.
- No telemetry, accounts, cloud APIs, or external lookups during scanning.
- The IEEE OUI table is stored locally.
- Local scan history is written only to `data/history.json` (or `HISTORY_PATH`), and is ignored by Git.
- The optional desktop notifications are a browser feature; nothing is sent to a server.

To clear all local history:

```powershell
Remove-Item data/history.json
```

## Known limitations

- ARP entries can outlive a device by a few minutes. Such devices are marked **IDLE** with zero power.
- Per-device Wi-Fi RSSI is not available from operating systems; see [About the signal bands](#about-the-signal-bands).
- Sleeping iPhones and locked-down IoT devices may not answer mDNS, so they can remain named by type/IP.
- A single missed sweep is treated as a Wi-Fi blip; drop alerts need two consecutive offline sweeps.
- Hosts that block both ICMP and every probed TCP port may remain visible only as an ARP entry.
- **Windows** uses PowerShell for adapter details and `nbtstat` for NetBIOS names.
- **Linux** needs `iproute2` and `iputils-ping`; Wi-Fi SSID/signal details are optional and depend on `iw`/`iwgetid`.
- **macOS** uses `networksetup` and `ifconfig`; Wi-Fi SSID detection may be unavailable if the interface is managed by a VPN or MDM profile.
- The scan is intentionally bounded to the local subnet: a full `/24`, or up to 510 addresses around the host for larger prefixes.
- The Windows path is the primary development target. Linux and macOS use equivalent native commands but have not been tested on every distribution/version.
