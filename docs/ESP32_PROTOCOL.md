# ESP32 ↔ App Protocol (v2)

This is the contract between the Android app and the ESP32 firmware. The app
side lives entirely in [`src/services/bluetooth/bleProtocol.ts`](../src/services/bluetooth/bleProtocol.ts)
and [`src/config/bleConfig.ts`](../src/config/bleConfig.ts). If you change
anything here, change it there too.

Bluetooth carries **car commands, OLED states and (optionally) audio for the
car's speaker**. v2 added the audio part; firmware without it still works and
the app then plays Robo's voice on the phone.

A complete, ready-to-flash sketch is in
[`firmware/robo_car/robo_car.ino`](../firmware/robo_car/robo_car.ino).

---

## 1. GATT layout

| Role    | Direction   | Properties                        | UUID (placeholder — replace!)          |
|---------|-------------|-----------------------------------|----------------------------------------|
| Service | —           | primary                           | `6e400001-0000-4000-8000-00000000c0de` |
| Command | phone → car | `WRITE`, `WRITE_NR`               | `6e400002-0000-4000-8000-00000000c0de` |
| Status  | car → phone | `NOTIFY` (+ `READ` optional)      | `6e400003-0000-4000-8000-00000000c0de` |
| Audio   | phone → car | `WRITE_NR` (optional — car speaker) | `6e400004-0000-4000-8000-00000000c0de` |

- **Generate your own UUIDs** (`uuidgen` or any online generator) and put the
  same values in the firmware and in `bleConfig.ts`.
- **Advertise** the service UUID and a device name starting with `Robo`
  (e.g. `Robo-Car`). The app's scanner only lists devices matching
  `BLE_CONFIG.DEVICE_NAME_PREFIXES` (`Robo`, `ESP32`) or advertising the service.
- After connecting, the app verifies the Command and Status characteristics
  exist. If they don't, it disconnects and shows "service UUID mismatch".
  If the Audio characteristic exists too, the app streams Robo's voice and
  sounds to the car (unless the user picked "Phone" in Settings).

## 2. Framing

- Every message is **one UTF-8 JSON object followed by `\n`**.
- On Android the app asks for an MTU of 185. If the negotiated MTU is smaller,
  a message is split across several writes. **The firmware must append incoming
  bytes to a buffer and only parse when it sees `\n`.** Cap the buffer
  (e.g. 256 bytes) and clear it if it overflows.
- Status notifications from the car use the same framing.

## 3. Phone → car messages (Command characteristic)

### Car command

```json
{"type":"car_command","command":"forward","speed":70}
{"type":"car_command","command":"backward","speed":50}
{"type":"car_command","command":"left","speed":50}
{"type":"car_command","command":"right","speed":50}
{"type":"car_command","command":"stop"}
```

| Field     | Type   | Rules                                                             |
|-----------|--------|-------------------------------------------------------------------|
| `command` | string | one of `forward` `backward` `left` `right` `stop`                 |
| `speed`   | int    | 0–100 (percent of max PWM). Absent for `stop`. Already capped by the app's safety limit. |

`left` / `right` mean *turn in place* (or pivot) — your choice in firmware.

### OLED state

```json
{"type":"oled","state":"listening"}
```

`state` is one of `idle` `listening` `thinking` `speaking` `moving` `stopped` `error`.
The firmware draws the face; see §6 for the layout used by the in-app preview.

### Audio control (v2, only if the firmware has the Audio characteristic)

```json
{"type":"audio_start","format":"ima_adpcm","sampleRate":16000,"samples":32000,"bytes":16000}
{"type":"audio_end"}
{"type":"audio_stop"}
```

| Message       | Meaning |
|---------------|---------|
| `audio_start` | A new clip starts. Drop anything still buffered, reset the ADPCM decoder. Its bytes follow on the **Audio** characteristic. Reply `state:"error"`, `message:"bad audio format"` for a format/rate you don't support. |
| `audio_end`   | All bytes were sent. Play out the buffer, then go quiet. |
| `audio_stop`  | Stop now and drop the buffer (the user interrupted Robo). |

See §8 for the audio format and timing.

## 4. Car → phone messages (Status characteristic, notify)

Send whenever something changes (not on every keep-alive):

```json
{"type":"status","state":"moving","command":"forward","speed":70,"battery":86}
{"type":"status","state":"stopped","command":"stop","speed":0,"battery":86,"message":"watchdog"}
```

| Field     | Type   | Required | Notes                                        |
|-----------|--------|----------|----------------------------------------------|
| `state`   | string | yes      | `idle` `moving` `stopped` `error`            |
| `command` | string | no       | last movement command                        |
| `speed`   | int    | no       | current speed 0–100                          |
| `battery` | int    | no       | percent, if you measure it                   |
| `message` | string | no       | short reason, e.g. `watchdog`, `bad speed`   |

Unknown fields are ignored; malformed frames are dropped by the app.

## 5. Safety rules the firmware MUST implement

The app is designed so that **losing the app always ends in a stopped car**,
but only if the firmware cooperates:

1. **Motor watchdog — 1000 ms.** While moving, the app re-sends the current
   command every **300 ms** as a keep-alive. If no `car_command` arrives for
   1000 ms, stop the motors and notify `{"state":"stopped","message":"watchdog"}`.
2. **Stop on disconnect.** In the BLE disconnect callback, stop the motors
   immediately (don't wait for the watchdog).
3. **Re-validate everything.** Reject unknown commands and speeds outside 0–100
   (reply with `state:"error"` and a `message`). Never map JSON fields to pins
   directly.
4. **Start stopped.** Motors off at boot. The app also sends `stop` right after
   connecting.
5. Timed moves ("go forward for 2 seconds") are timed **by the app**, which
   sends `stop` at the end. The watchdog covers the case where that `stop`
   never arrives.

The in-app simulated car ([`mockCar.ts`](../src/services/bluetooth/mockCar.ts))
implements exactly these rules and is a good reference.

## 6. OLED face layout (128 × 64, monochrome)

The in-app preview ([`faceGeometry.ts`](../src/components/RobotFace/faceGeometry.ts),
[`RobotFace.tsx`](../src/components/RobotFace/RobotFace.tsx)) draws in OLED pixel
coordinates, so you can copy the numbers:

| Element   | Geometry                                     |
|-----------|----------------------------------------------|
| Left eye  | rounded box x=28 y=14 w=24 h=24 r=6          |
| Right eye | rounded box x=76 y=14 w=24 h=24 r=6          |
| Mouth     | centred at (64, 50), ~28 px wide             |

| State       | Eyes                               | Mouth                     | Animation                 |
|-------------|------------------------------------|---------------------------|---------------------------|
| `idle`      | rounded boxes                      | smile arc                 | blink every ~3 s          |
| `listening` | boxes with a small black highlight | small circle "o"          | eyes pulse, sound bars at the edges |
| `thinking`  | squinted (h≈12), top of eye box    | three dots                | dots light up in turn     |
| `speaking`  | rounded boxes                      | filled ellipse            | mouth opens/closes        |
| `moving`    | happy `^` arcs                     | big filled smile          | small bounce              |
| `stopped`   | rounded boxes                      | flat line                 | blink                     |
| `error`     | `X` eyes                           | frown                     | flashing                  |

## 7. Firmware

[`firmware/robo_car/robo_car.ino`](../firmware/robo_car/robo_car.ino) implements
everything above for Arduino-ESP32 core 3.x: the GATT service, JSON framing,
motors on an L298N-style driver, the watchdog, stop-on-disconnect, and the car
speaker (§8), and the animated OLED faces of §6 on a 1.3" SH1106 (Adafruit
SH110X library). Wiring and library setup are in the comment at the top of the
file.

## 8. Car speaker audio

The phone does the text-to-speech (the same voice it would speak with) and
decodes the sound effects, then streams them to the car:

```
phone: PCM → 16 kHz mono → IMA ADPCM ──BLE──► ESP32: ring buffer → decode → I2S → MAX98357A → speaker
```

| Item | Value |
|------|-------|
| Format | IMA ADPCM, mono, **16 000 Hz**, 4 bits/sample → **8000 bytes/s** |
| Byte layout | two samples per byte, **first sample in the low nibble** |
| Decoder state | predictor = 0, step index = 0 at every `audio_start`; no block headers |
| Tables | standard IMA step (89 entries) and index (16 entries) tables — identical in [`pcm.ts`](../src/services/audio/pcm.ts) and the sketch |
| Chunk size | ≤ negotiated MTU − 3 per write (the app asks for MTU 185; the sketch allows 247) |
| Pacing | the app never sends more than **1 s** ahead of real-time playback |
| Prebuffer | start playing after **250 ms** of audio (2000 bytes) or at `audio_end`; after an underrun, wait for 250 ms again |
| Buffer | ≥ 12 KB. The sketch uses a 16 KB FreeRTOS byte ring buffer |

Rules for the firmware:

1. **Binary data.** Read audio writes with `getData()`/`getLength()`, not
   `getValue()` (a string that stops at the first zero byte).
2. **Never block in the BLE callback.** Copy bytes into a ring buffer and
   decode/write to I2S from a separate task. `i2s.write()` blocks, which paces
   playback naturally.
3. **Motors first.** Audio must not delay the motor watchdog or `stop`.
4. **Write silence** after a clip ends or stops so the I2S DMA doesn't loop
   the last buffer.

The phone estimates when the car finishes (clip length + a small margin) —
that is when hands-free mode starts listening again. Put the speaker away from
the phone's microphone if Robo keeps hearing itself.
