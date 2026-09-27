# Robo Car — Hardware Integration Context (paste into your design/prototype chat)

You are helping design the UI prototype for **Robo Car**, an Android companion app
for a small ESP32 robot car. A working app already exists (Expo SDK 57, React
Native 0.86, TypeScript, Expo Router, Zustand, `react-native-ble-plx`). The
Bluetooth link, safety logic and firmware protocol below are **fixed**. Your
prototype must fit this contract. Don't invent new hardware features, commands
or data fields. If a screen needs something that isn't listed here, flag it as
a **protocol change request**; don't design it as if it already works.

---

## 1. System overview

```
PHONE (the brain)                                     ESP32 CAR (the body)
- UI, AI chat, speech-to-text, text-to-speech   BLE   - 2 motors via H-bridge
- sound effects (played on the PHONE speaker)  <----> - 128x64 monochrome OLED face
- safety gate for every command                       - battery % (optional)
                                                      - speaker: NOT in v1
```

- The phone and the car talk **only over Bluetooth Low Energy (BLE)**. No Wi-Fi, no internet link to the car.
- **All audio (AI voice and sounds) plays on the phone** in v1. The car has no speaker yet.
- The car has **no camera, no sensors, no GPS, no autonomy**. It only does what the phone tells it.
- The car only understands two kinds of message: **drive commands** and **OLED face states**.

---

## 2. What the phone can send to the car

Every message is one JSON object followed by a newline (`\n`), written to the Command characteristic.

### 2a. Drive commands. This is the complete list.

```json
{"type":"car_command","command":"forward","speed":70}
{"type":"car_command","command":"backward","speed":50}
{"type":"car_command","command":"left","speed":50}
{"type":"car_command","command":"right","speed":50}
{"type":"car_command","command":"stop"}
```

- `command`: only `forward`, `backward`, `left`, `right`, `stop`.
- `left` and `right` turn in place. There is no "forward-left" curve and no diagonal.
- `speed`: an integer 0–100, meaning percent of motor power. It is **not** a real-world speed (no km/h or cm/s).
- There is **no** steering angle, distance ("go 1 metre"), acceleration curve, lights, horn or per-wheel control.

### 2b. OLED face states. This is the complete list.

```json
{"type":"oled","state":"listening"}
```

The phone sends only the state name, and the ESP32 draws the face. The possible states are:

| State       | When the app sends it                         | Face on the car                          |
|-------------|-----------------------------------------------|------------------------------------------|
| `idle`      | nothing happening                             | rounded eyes, smile, blinks every ~3 s   |
| `listening` | mic is on, user is talking                    | eyes with highlight, small "o" mouth, sound bars |
| `thinking`  | waiting for the AI                            | squinted eyes, three animated dots       |
| `speaking`  | phone is talking or playing a sound           | mouth opening and closing                |
| `moving`    | car is driving                                | happy `^` eyes, big smile, small bounce  |
| `stopped`   | shown for ~1.5 s after a move ends            | flat mouth                               |
| `error`     | shown for ~2.5 s after an error               | `X` eyes, frown, flashing                |

The app chooses the face automatically, in this priority order: preview override (Settings), then error, then listening, then thinking, then speaking, then moving, then stopped, then idle.
The app shows the same face on screen (the "Robo face") using the car's OLED pixel geometry: 128×64 canvas, eyes are 24×24 rounded boxes at x=28 and x=76, y=14, and the mouth is centred at (64, 50). **If you redesign the on-screen face, keep it drawable on a 128×64 one-colour OLED.** Otherwise the car and the app won't match.

---

## 3. What the car sends back to the phone

The car sends notifications on the Status characteristic, using the same JSON + `\n` framing. It sends one only when something changes:

```json
{"type":"status","state":"moving","command":"forward","speed":70,"battery":86}
{"type":"status","state":"stopped","command":"stop","speed":0,"battery":86,"message":"watchdog"}
```

| Field     | Always present? | Values                                   |
|-----------|-----------------|------------------------------------------|
| `state`   | yes             | `idle`, `moving`, `stopped`, `error`     |
| `command` | no              | last movement command                    |
| `speed`   | no              | 0–100                                    |
| `battery` | no              | 0–100 %. **May be missing** if the car doesn't measure it |
| `message` | no              | short reason, e.g. `watchdog`, `bad speed`, `unknown command` |

**This is all the telemetry that exists.** No RSSI graph, motor temperature, distance travelled, obstacle sensor or live video.
Design every status widget so it works when `battery` is missing: show "—" or hide the widget.

---

## 4. Connection flow the UI must support

BLE connection states (the app tracks these exactly):

| State          | Meaning                                       | UI must show                                          |
|----------------|-----------------------------------------------|-------------------------------------------------------|
| `disconnected` | no car linked. The app is in **Demo Mode**     | banner "Demo Mode — ESP32 not connected"; everything still usable |
| `connecting`   | pairing in progress (timeout 10 s)            | spinner on the selected device                        |
| `connected`    | linked to a real car                          | device name (e.g. "Robo-Car") and a Disconnect button |
| `reconnecting` | link dropped. App retries 3× (1 s, 2 s, 4 s)  | "Car disconnected — stopped. Reconnecting…"           |

Phone Bluetooth adapter states the UI should handle: `poweredOn`, `poweredOff`,
`unauthorized` (permission denied), `unsupported`, `unavailable` (running in
Expo Go or on web, where there is no BLE module), and `unknown`.

**Scan → connect flow:**
1. User taps **Scan**. Android asks for the "Nearby devices" permission (or Location on Android 11 and older).
2. The scan runs for up to **10 s** and lists devices whose name starts with `Robo` or `ESP32`, or that advertise the car's service. Each device has an `id`, a `name` (may be null) and an `rssi` (signal strength, may be null).
3. User taps a device → `connecting` → `connected`.
4. As soon as the link is up, the app **automatically sends `stop`** and re-sends the current face.
5. A **Disconnect** button returns to Demo Mode.
6. An **Auto-reconnect** toggle (on by default) lives in Settings.

**Demo Mode:** when no car is connected, every command goes to a simulated car
inside the app. The simulated car uses the same protocol and sends back the
same status messages. The whole UI must be fully usable in Demo Mode, with a
clear banner so the user knows the real car isn't moving.

**Error messages already in the app.** Reuse these, or keep their meaning:

| Error              | Message shown                                                                 |
|--------------------|-------------------------------------------------------------------------------|
| unavailable        | Bluetooth isn't available in this build. Use a development build or APK (Demo Mode still works). |
| powered_off        | Bluetooth is turned off. Turn it on to connect to the car.                    |
| permission_denied  | Bluetooth permission was denied. Allow "Nearby devices" in Android settings.  |
| scan_failed        | Couldn't search for cars. Check that Bluetooth and Location are on, then try again. |
| device_not_found   | Car not found. Make sure the ESP32 is powered on and nearby.                  |
| connection_failed  | Couldn't connect to the car. Move closer and try again.                       |
| service_not_found  | Connected, but this device doesn't look like the Robo car (service UUID mismatch). |
| write_failed       | Couldn't send the command to the car.                                         |
| disconnected       | The car disconnected.                                                         |
| (none found)       | No cars found. Is the ESP32 powered on and advertising?                       |

---

## 5. Safety rules the UI must respect (non-negotiable)

These rules exist because a real car is moving. Do not design around them.

1. **Hold-to-drive only.** The car moves only while the user's finger is on a
   direction button. Releasing the button, or sliding the finger off it, sends
   `stop` immediately. **No tap-to-toggle driving and no "cruise" mode.**
2. **Big STOP button**, always visible on the drive screen. It is never
   disabled and works in every state.
3. **Keep-alive:** while a button is held, the app re-sends the command every
   **300 ms**. If the car hears nothing for **1 s**, it stops by itself (the
   watchdog). So a frozen or backgrounded app always ends in a stopped car.
   **Don't design anything that drives the car while the app is in the
   background, or while the screen is off.**
4. **Speed limit:** the speed slider runs from 0 to the user's limit.
   The limit defaults to **80** and can be changed in Settings, up to a
   maximum of 100. The default drive speed is 60, and the default for voice
   and AI moves is 50.
5. **Voice/AI moves are always timed:** between **0.2 and 5 s** (2 s if the
   user doesn't say). The app sends `stop` at the end. There are no open-ended
   voice commands like "drive until I say stop".
6. **The AI can't start the motors on its own.** It can move the car only if
   the user's own words asked for movement. The AI can always stop the car.
7. When the app goes to the background, it stops the car and cancels voice.
8. When the link drops mid-drive, the app shows "Car disconnected — stopped."
   Show it as a warning, not a silent state change.

---

## 6. Features that exist today (map your screens to these)

| Tab           | What it does                                                                 |
|---------------|------------------------------------------------------------------------------|
| **Home**      | Animated Robo face, connection and car status (state, speed, battery), "Talk to Robo" and "Drive" shortcuts |
| **Control**   | Hold-to-drive D-pad (up/down/left/right), big STOP, speed slider, live current command and status |
| **Companion** | Chat with Robo by typing or voice. It answers questions, drives the car (timed) and plays sounds |
| **Sounds**    | Soundboard: `cow`, `dog`, `cat`, `lion`, `robot`, `laugh`, `beep` (plays on the phone) |
| **Settings**  | Scan/connect/disconnect, auto-reconnect, AI provider (OpenRouter or Groq), model, API key, test connection, voice options, speed limit, OLED face preview (force a face for testing) |

Voice pipeline states you can show: `idle`, `listening` (with a live partial
transcript), `processing`, `speaking`, `error`. Voice input needs a real build.
In Expo Go, typing still works.

---

## 7. Not possible in v1 (do not design as working features)

Camera or live video · obstacle detection or distance sensors · autonomous or
line-following driving · GPS or maps · the car's own speaker (audio on the car)
· LEDs or horn on the car · multiple cars at once · Wi-Fi control · user
accounts or cloud sync · real speed or distance readouts · diagonal or curved
steering · battery charging status.

If you want any of these, list them as **"future — needs firmware/protocol change"**.

---

## 8. Technical details (for whoever writes code from the prototype)

- **Stack:** Expo SDK 57, React Native 0.86, TypeScript (strict), Expo Router
  (routes in `src/app/`), Zustand store. BLE uses `react-native-ble-plx`, which
  needs a development build or APK, not Expo Go. The app is portrait-only and dark-themed.
- **Layering:** screens → hooks → services. **Screens never touch Bluetooth
  directly.** New UI should use the existing hooks:
  - `useBluetooth()` → `adapterState, connectionState, connectedDevice, isScanning, discoveredDevices, autoReconnect, isDemoMode, isBluetoothAvailable, scan(), stopScan(), connect(device), disconnect(), setAutoReconnect(bool)`
  - `useCarControl()` → `speed, speedLimit, currentCommand, carStatus, press(direction), release(), emergencyStop(), setSpeed(n)`
    - Wire `press(dir)` to the press-in event and `release()` to press-out and to the finger leaving the button.
  - `useVoiceAssistant()`: voice and chat.
  - Store fields: `carStatus { state, command, speed, battery, updatedAt, origin: 'device' | 'demo' }`, `oledState`, `voiceState`, `partialTranscript`, `conversation`, `notice` (toast).
- **GATT layout.** The UUIDs are placeholders until the firmware sets its own:
  - Service `6e400001-0000-4000-8000-00000000c0de`
  - Command (phone→car, write) `6e400002-0000-4000-8000-00000000c0de`
  - Status (car→phone, notify) `6e400003-0000-4000-8000-00000000c0de`
  - Audio `6e400004-…` is reserved and unused in v1.
- **Framing:** UTF-8 JSON + `\n`. The app requests an MTU of 185 and splits long messages across several writes. The firmware buffers the bytes until it sees `\n`.
- The ESP32 advertises as `Robo-Car` (the name must start with `Robo` or `ESP32`).

**If you produce code:** give only screen and component code that uses the hooks
above. Don't write a new Bluetooth layer, new message formats, or new command
names. Those already exist and are tested against the firmware contract.
