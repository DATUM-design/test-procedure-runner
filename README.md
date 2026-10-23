# Test Procedure Runner

A phone and tablet driver's aid for vehicle test procedures. It runs a procedure step by step and logs GPS speed, position and accelerometer data at 10 Hz. Runs are stored on the device and exported as CSV.

It runs in the browser, works offline after the first visit, and can be added to the home screen like an app.

## Using it

1. Open the GitHub Pages address on the phone or iPad, in Safari (iOS) or Chrome (Android).
2. **Share → Add to Home Screen**, then open it from the home-screen icon.
3. **Sensors → Enable sensors.** Allow location (choose *precise*) and motion.
4. With the car stationary on level ground and the phone in its mount, tap **Zero accelerometer**.
5. Pick a procedure. Driving steps use **Start / Pause**, then **Next step** when complete. Checklist and record steps, if a procedure has them, use **Continue**.
6. When the run ends, use **Export CSV** to share the log and summary (AirDrop, email, Files, Teams).

**Rehearse first:** set Sensors → Speed source to *Simulated* to run any procedure at the desk.

### Sensor notes

- **GPS:** phone GPS updates at about 1 Hz with roughly 1 s of lag. That is fine for following a trace and judging speed bands. Wi-Fi-only iPads have no GPS chip; use a cellular model or a phone.
- **Accelerometer:** this is used for brake decel. The phone must be rigidly mounted. After zeroing, the forward direction is learned automatically from the first few firm accelerations and stops; the Sensors screen shows "Learned" when it is ready. Until then, decel falls back to GPS (coarse).
- **External GPS:** in Chrome/Edge on a laptop or Android, *USB / Bluetooth NMEA GPS* reads a 10 Hz receiver over Web Serial.
- Keep the screen on. The app requests a wake lock, but disable auto-lock if the screen still sleeps.

## Files

```
index.html            app shell
app.css               styles
js/                   util, store (IndexedDB), sensors, step types, app
procedures/index.json list of procedure files shown on the home screen
procedures/*.json     procedures
cycles/*.json         speed traces (1 Hz)
sw.js                 offline cache
```

## Writing a procedure

A procedure is a JSON file. Add it to `procedures/` and list it in `procedures/index.json`. Alternatively, keep it private: on the phone use **Add procedure from a file**, and it is stored on that device only.

```json
{
  "id": "my-procedure",
  "name": "Shown on the home screen",
  "group": "Millbrook",
  "description": "One line",
  "units": "kmh",
  "steps": [ ... ]
}
```

`units` is `"kmh"` or `"mph"` and applies to every speed in the file. `group` sorts procedures into sections on the home screen, for example by proving ground (`"Millbrook"`, `"Nardo"`, `"Idiada"`). Without one, a procedure goes under *General*.

During any test, **Notes** records the vehicle ID, driver and free text with the run. The vehicle and driver are remembered for the next test. **End test** (tap twice) finishes the run at any point.

### Step types

| type | what it does | fields |
| --- | --- | --- |
| `checklist` | Tick every item to continue | `items: [string]` |
| `record` | Type in values (odometer, temperatures, notes) | `fields: [{ key, label, unit?, type?: "text" }]` |
| `timer` | Countdown, e.g. soak or settle | `duration` (s) |
| `hold` | Hold a speed for a time or distance | `speed`, `tolerance`, and `duration` (s) or `distance` (m) |
| `trace` | Follow a speed trace with a tolerance band | `segments: [{ cycle: "udds" } \| { idle: 120 }]`, `tolerance: { speed, time }` |
| `stops` | Repeated braking stops with a live speed graph, auto counter and decel grading | `count`, `from`, `to`, `decel: { target, tolerance }` (g), `between: { distance }` (m) or `{ time }` (s) |

Every step takes an optional `name` and `note`.

#### How `stops` works

For each stop: accelerate to `from`, then the screen shows **BRAKE**. Braking is detected from the accelerometer, or from the GPS speed falling. The stop ends when speed reaches `to`. Mean and peak decel are compared with `target ± tolerance` and graded **In band**, **Low** or **High**. A stop released early is shown as **Not counted**. Then comes the cooling drive (`between`) before the next stop. **Count stop manually** and **Undo last stop** cover sensor misses.

### Adding a trace

Put a file in `cycles/` such as `cycles/wltc3b.json`:

```json
{ "name": "WLTC 3b", "unit": "kmh", "dt_s": 1, "speed": [0, 0, 1.2, 2.6] }
```

Then reference it in a trace step with `{ "cycle": "wltc3b" }`.

## CSV output

- `*_log.csv`: 10 Hz rows of run time, UTC, step, phase, target, speed, lat/lon, GPS accuracy, longitudinal g, decel g and its source, distance, stop number and markers.
- `*_summary.csv`: run info, recorded values, step results, every stop (speeds, duration, mean/peak g, grade), and all events and markers.

## Traces included

- UDDS: 40 CFR 86 Appendix I, EPA Urban Dynamometer Driving Schedule (1,369 s, 7.45 mi).
- NYCC: EPA New York City Cycle (598 s, 1.18 mi).

The brake bedding procedure is a generic example. Replace its numbers with your own specification before use.
