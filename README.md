# Polestar for Homey

Unofficial Homey Pro integration for Polestar vehicles. Connects to Polestar's C3
cloud backend (the same one the Polestar mobile app uses) to expose vehicle
status and remote-control commands as Homey capabilities and flow cards.

## Supported vehicles

- **Polestar 4** — tested
- **Polestar 3** — verified through the official C3 linked-vehicle discovery and control backend
- **Polestar 2** — should work via C3; feedback from P2 owners welcome

Feature availability differs per model. The integration probes each service on
first use and automatically hides capabilities the car reports as
`UNIMPLEMENTED` (e.g. charging amperage limit is not exposed on Polestar 4).

## What's included

**Read**: battery level, charging status, power / current / voltage while
charging, session + lifetime kWh, range, odometer, interior + target
temperature, parking climatization state and time remaining, lock status,
per-door and per-closure open/closed alarms, tyre pressures (four wheels in
kPa), service warnings and distance-to-service, last known GPS location, OTA
software update state.

**Write**: start/stop charging, set charge limit and amperage, lock/unlock,
unlock trunk, honk and flash, start/stop parking climatization (with
temperature, per-seat heating, steering-wheel heating), open/close all
windows.

All writes are exposed as both device tiles and flow action cards. A device
setting provides a master-switch to disable writes globally, and optional
features can be hidden per-device when unsupported.

## Configuration

Pair a vehicle with your Polestar ID email and password. Homey handles OIDC
authentication automatically; tokens refresh transparently.

## The `polestar-2-csv` driver

The older *Car Stats Viewer* webhook driver is marked deprecated — the main
`vehicle` driver now covers all its battery/charging/range functionality and
more. Existing devices keep working; no new pairings are accepted. P2 owners
who rely on the webhook for real-time driving telemetry (speed, gear, ignition,
battery temperature, trip summaries) can keep using it alongside the main
driver.

## Disclaimer

This integration is unofficial and not affiliated with or endorsed by Polestar
or Volvo Cars. Use at your own risk. Authentication uses reverse-engineered
endpoints that may change or break without notice.
