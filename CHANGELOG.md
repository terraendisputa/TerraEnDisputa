# Changelog

## 1.1.1 — 2026-10-31

- Security review fixes. Request limits now count each seat or the host on its own and everyone else by address, so a flood without a valid session (made-up cookies included) never blocks the people playing. Failed host logins wait longer after each try, only for the address that sent them.
- Hardened desktop app: no DevTools, no running as Node, permission requests refused except copying and full screen, and no spell-check dictionary download.
- Stricter content security policy, a sandbox for the system service installed by the script, and the server refuses to start with a trusted proxy but no public address.
- Sign out for the host. Retake live connections close when a seat is removed.
- The host panel shows the installed version with a link to the releases.
- Waiting room readable in the dark theme, and keyboard focus follows each country's shape on the maps.
- Node 24.22.2 and Electron 44.10.0; CI actions pinned and release files with signed provenance.

## 1.1.0 — 2026-10-30

- Desktop app for Windows and Linux: the server runs in its own window with the host panel already signed in and keeps running in the system tray. Windows installer (with a firewall rule for private networks), AppImage, deb and tar.gz.
- AUR and Flathub packaging for the desktop app.
- «How to play» pages served by the game and linked from its start screen.
- Console and script messages in English, or in Spanish when the system language is Spanish.
- Sharper map when zoomed in.

## 1.0.2 — 2026-10-29

- Retake games with bots load again after the server restarts.

## 1.0.1 — 2026-10-28

- Competitive follows the Superliga rules: border pacts only, a wait after a rejected pact, disconnection grace, tiebreak and a suicide block; deciding games.
- Bots (easy, normal and hard) for Classic, Competitive and Retake: bot tables, replacement of absent players, host controls and pact diplomacy.
- Classic Express and Retake Express, with game clocks and two final rounds.
- Reconquista is now called Retake in English; condominium invasions and lost reinforcements when every country is blocked.
- Full English translation with a language selector on every page, dark theme by default and a text size control.
- Map label fixes, music by game moment, result panels at game end and a consistent host panel.

## 1.0.0 — 2026-10-24

First stable release.

- Self-hosted browser strategy game for 2–6 players, played from any modern browser on computer, tablet or phone through a shared invitation link.
- Three modes chosen when creating a game: Classic (50 countries, secret objectives and pacts), Competitive (4–6 players with clocks, automatic final rounds and scoring) and Reconquista (72 countries, round situations, missiles, alliances and shared countries).
- Server-authoritative play with private cards and objectives, persistent games, automatic reconnect and live updates.
- Host panel with a fresh administrator code on every start, network selection for invitations, and Competitive results export (JSON/CSV).
- Light and dark themes, keyboard shortcuts, music and turn chime, and touch controls with map zoom and pan.
- Portable Linux x64 and Windows x64 packages with a bundled Node.js runtime, licenses and SHA-256 checksums.
- Linux installer and uninstaller for a systemd service, with backups and automatic rollback on a failed update.
- Built-in `backup` and `restore` commands covering all three modes.
- LAN, private VPN (such as Tailscale) and HTTPS reverse-proxy or tunnel hosting.
- No accounts, telemetry or automatic update checks. Licensed `AGPL-3.0-only`.
