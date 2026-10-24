# Changelog

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
