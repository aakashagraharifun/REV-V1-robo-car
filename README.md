# Robo Car — AI Companion App

An Android app (React Native + Expo + TypeScript) that is the "brain" of a small
ESP32 robot car. The phone does the AI conversation, speech recognition and UI.
The ESP32 drives the motors, shows a face on its OLED and **speaks through its
own speaker**. They talk over Bluetooth Low Energy.

```
                ANDROID APP
      ┌─────────────┼──────────────┐
      ▼             ▼              ▼
 CAR CONTROL     AI BRAIN        VOICE (hands-free)
      │       OpenRouter/Groq   phone mic → speech-to-text
      │             │           text-to-speech → audio
      └──── intent router + command validator
                    │
                   BLE  (JSON commands + OLED states + ADPCM audio)
                    ▼
                  ESP32 ──► motors · OLED face · MAX98357A → car speaker
```

You talk to the phone; Robo answers **from the car**. If the car has no
speaker (or isn't connected), Robo falls back to the phone speaker.

---

## Features

| Tab           | What it does |
|---------------|--------------|
| **Home**      | Animated Robo face, connection + car status, "Talk to Robo", "Drive" |
| **Control**   | Hold-to-drive D-pad, big emergency **STOP**, speed slider, live command/status |
| **Companion** | Talk with Robo. **Hands-free** mode keeps listening and answering out loud (say “stop listening” to end). It answers questions, drives the car and plays sounds. Typing works too |
| **Sounds**    | Soundboard with real recordings: cow, dog, cat, lion, laugh — plus robot and beep |
| **Settings**  | Scan/connect the car, AI provider/model/key, voice options (incl. car speaker vs phone), speed limit, OLED face preview |

**Demo Mode (Mock Car Mode).** When no ESP32 is connected, every command goes
to a simulated car that speaks the same protocol, reports status and enforces
the same watchdog. You can test everything except real Bluetooth without
hardware. A banner reads *"Demo Mode — ESP32 not connected"*.

---

## Quick start

Requirements: Node 20+ (tested with Node 22), an Android phone, and a free
[Expo account](https://expo.dev/signup) for cloud builds.

```bash
cd robo-car
npm install
cp .env.example .env        # optional: add AI keys/models (or add them later in Settings)
npx expo start
```

### Why voice and Bluetooth don't work in Expo Go

Expo Go is a prebuilt app from the Play Store. It only contains the native
(Java/Kotlin) code that ships with Expo, and it can't load new native code.
This app needs three native pieces that **Expo Go does not have**:

- `expo-speech-recognition` — the microphone → text part of voice control,
- `react-native-ble-plx` — Bluetooth to the ESP32,
- `modules/robo-tts` — this project's own module that renders Robo's voice
  into audio for the car speaker.

In Expo Go the app notices they're missing and falls back (typing, Demo Mode,
phone speaker). **Install the APK or a development build and they all work** —
nothing in the code has to change.

| Runs in…            | Bluetooth | Voice input / hands-free | Car speaker | Everything else |
|---------------------|-----------|--------------------------|-------------|-----------------|
| Expo Go             | ✗ (Demo Mode) | ✗ (typing works)     | ✗ (phone)   | ✓ |
| Development build / APK | ✓     | ✓                        | ✓           | ✓ |

Voice input also needs Google's speech services on the phone (the **Google**
app, or "Speech Services by Google"). Most Android phones have it. On phones
whose default recognizer is a vendor one (e.g. Bixby) the app picks Google's
automatically.

For day-to-day development with the real car, build a **development build** once:

```bash
# Cloud build (no Android Studio needed) — installs like any APK
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile development
# install the APK from the link EAS prints, then:
npx expo start --dev-client
```

Or build locally if you have Android Studio + JDK 17: `npx expo run:android`.

You only rebuild when native dependencies or `app.json` plugins change. JS
changes reload over Wi-Fi as usual.

---

## Building the installable APK

`eas.json` defines three profiles:

| Profile       | Output | Use |
|---------------|--------|-----|
| `development` | APK with dev client | day-to-day development |
| `preview`     | standalone **APK** | install on phones / share for testing |
| `production`  | AAB | Play Store |

```bash
npx eas-cli@latest build -p android --profile preview      # or: npm run build:apk
```

When the build finishes, open the link on your phone (or scan the QR code),
download the `.apk` and install it. Allow "install unknown apps" if Android asks.

**AI keys in cloud builds:** `.env` is git-ignored, so EAS does **not** upload
it. Either paste the key in the installed app (**Settings → AI brain**, stored
in the Android keystore), or define the variables on EAS for the `preview`
environment:

```bash
npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_GROQ_API_KEY --value "gsk_..." --visibility sensitive
npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_GROQ_MODEL --value "<model-id>" --visibility plaintext
```

**Local APK (no EAS):** with Android Studio/JDK 17 installed:

```bash
npx expo prebuild -p android
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk (signed with the debug key; fine for personal installs)
```

`android/` is generated (Continuous Native Generation). Don't edit it by hand.
Configure native things in `app.json` / `plugins/`.

---

## Connecting the ESP32

1. **Wire it** (pins can be changed at the top of the sketch):

   | Part | ESP32 pins |
   |------|------------|
   | L298N (ENA/ENB jumpers removed) | ENA 25 · IN1 26 · IN2 27 · ENB 13 · IN3 32 · IN4 33 · common GND |
   | MAX98357A I2S amp + speaker | BCLK 14 · LRC 15 · DIN 22 |
   | OLED 1.3" SH1106 128×64 (I2C, 0x3C/0x3D) | SDA 21 · SCL 23 |

   Test the motors first with `firmware/robo_car_wifi_test` (no app needed):
   join the `RoboCar-Test` Wi-Fi (password `robocar123`) and open
   http://192.168.4.1.

2. **Flash the firmware**: open [`firmware/robo_car/robo_car.ino`](firmware/robo_car/robo_car.ino)
   in the Arduino IDE.
   - Boards Manager → install **esp32 by Espressif (3.x)** → board **ESP32 Dev Module**
   - Library Manager → install **ArduinoJson** (v7) and **Adafruit SH110X**
     (click "Install all" so Adafruit GFX and BusIO come with it)
   - Upload, then open the Serial Monitor at 115200. It prints
     `[ble] advertising as Robo-Car`.
3. **Connect from the app** (APK, not Expo Go): turn on Bluetooth → **Settings →
   Bluetooth car → Scan for cars** → tap **Robo-Car**. Allow the
   "Nearby devices" permission. Do **not** pair it in Android's Bluetooth
   settings: BLE devices connect from inside the app.
4. **Settings → Voice → Robo’s voice comes from: Car speaker.** The line under
   it says whether the connected car has a speaker. Tap **Test voice**; it
   should come out of the car.

The UUIDs in the sketch and in `src/config/bleConfig.ts` must match. If you
change them, change both. The full protocol is in
[docs/ESP32_PROTOCOL.md](docs/ESP32_PROTOCOL.md).

## Hands-free voice control

Companion tab → **Hands-free** (or **Hands-free voice control** on Home). Robo
then keeps listening; after each answer it listens again. Everything works by
voice: questions, "go forward for 2 seconds", "stop", "make a lion sound".

- Say **“stop listening”** / **“goodbye”** (or tap the mic) to end it. A plain
  **“stop”** still stops the car.
- It turns itself off after 2 minutes of silence and when the app goes to the
  background (Android doesn't allow the microphone in the background).
- Replies are always spoken in hands-free mode, even if "Speak replies out
  loud" is off.
- Android plays a short beep each time the recognizer starts listening. That
  comes from Google's recognizer and the app can't turn it off.

## Car speaker

With the car speaker selected and a car with the audio characteristic
connected:

- **Speech:** the phone's text-to-speech engine renders Robo's reply into a WAV
  file (native module `modules/robo-tts`, Android `TextToSpeech.synthesizeToFile`)
  instead of playing it.
- **Sounds:** the bundled WAV clips are decoded.
- Both are converted to 16 kHz IMA ADPCM (8 KB/s) and streamed over BLE. The
  ESP32 decodes them and plays them through the MAX98357A.

If streaming fails (for example the car disconnects mid-sentence), that clip
plays on the phone instead, so Robo is never silently mute.

## AI configuration

The app talks to AI through a provider interface (`AIProvider.generateResponse`).
OpenRouter and Groq are implemented. Switch in **Settings** or with
`EXPO_PUBLIC_AI_PROVIDER`.

| Variable | Meaning |
|----------|---------|
| `EXPO_PUBLIC_AI_PROVIDER` | `openrouter` or `groq` |
| `EXPO_PUBLIC_OPENROUTER_API_KEY` / `EXPO_PUBLIC_OPENROUTER_MODEL` | OpenRouter key + any model id from openrouter.ai/models |
| `EXPO_PUBLIC_GROQ_API_KEY` / `EXPO_PUBLIC_GROQ_MODEL` | Groq key + any model id from console.groq.com/docs/models |
| `EXPO_PUBLIC_*_BASE_URL` | Optional override, e.g. your own backend proxy |

No model name is hard-coded. Set one in `.env` or type it in Settings. Use
**Settings → Test connection** to check key + model. Groq is noticeably faster,
which matters for voice.

Errors (bad key, rate limit, unavailable model, timeout, no internet, empty or
invalid response) are shown as short friendly messages and never crash the app.

### API key security

- **A mobile app cannot keep an API key secret.** `EXPO_PUBLIC_*` values are
  embedded in the JavaScript bundle in plain text, and a key typed into
  Settings lives on the phone. Anyone with the APK or the phone can extract it.
- This is acceptable for a **personal prototype**. Use a dedicated key with a
  low spending limit, and never commit `.env` (it's in `.gitignore`).
- The logger redacts anything that looks like a key or bearer token.

### Moving to a backend (recommended before sharing the app)

```
React Native app ──► your backend (holds the key, rate-limits, filters) ──► OpenRouter / Groq
```

Because both providers use the OpenAI-compatible `/chat/completions` format,
the app side is a config change. Deploy a small proxy (Cloudflare Worker,
Vercel function, Express…) that forwards `POST /chat/completions` and adds the
`Authorization` header server-side, then set:

```
EXPO_PUBLIC_GROQ_BASE_URL=https://your-proxy.example.com/v1
EXPO_PUBLIC_GROQ_API_KEY=<a per-app token your proxy checks, not the Groq key>
```

For stronger isolation, add a `BackendProvider` implementing `AIProvider` in
`src/services/ai/` and register it in `AIService.ts`.

---

## How a request flows

1. **Voice or text in.** The mic uses the phone's speech recognizer (`expo-speech-recognition`).
2. **Intent router** (`src/services/intent/`):
   - Offline **rules** catch clear commands first ("go forward", "stop",
     "make a cow sound"). These are instant and work without internet.
   - Everything else goes to the AI, which must reply with one JSON object:
     `CAR_COMMAND`, `SOUND_REQUEST`, `AI_QUESTION` or `GENERAL_CONVERSATION`.
3. **Command validator**: the safety gate (see below).
4. **Action**: drive the car / play a sound / show the answer.
5. **Reply**: Robo confirms only what actually happened and speaks it: on
   the car speaker when available, otherwise the phone. The OLED face follows
   along (listening → thinking → speaking / moving).

## Safety

- Large **STOP** button on the Control screen. Arrows are hold-to-drive:
  releasing or sliding off stops the car.
- **Every** command (D-pad, voice rules, AI) passes `commandValidator.ts`:
  only `forward/backward/left/right/stop`, speed 0–100 (clamped to the user's
  limit, default 80%), voice/AI moves limited to 0.2–5 s. Invalid → rejected.
- The AI **cannot start the motors** unless the user's own words explicitly ask
  for movement. It can always *stop*.
- AI output is parsed as data only. There is no code execution and no raw pin access.
- While moving, the app sends a keep-alive every 300 ms. The firmware must stop
  after 1 s of silence (watchdog) and on BLE disconnect (see protocol doc).
- The app clears its drive timers on disconnect and stops the car when it goes
  to the background.

## ESP32 protocol

See **[docs/ESP32_PROTOCOL.md](docs/ESP32_PROTOCOL.md)**: GATT layout, JSON
messages, framing, required firmware safety rules, OLED face geometry and a
starter Arduino sketch.

```json
{"type":"car_command","command":"forward","speed":70}
{"type":"car_command","command":"stop"}
{"type":"oled","state":"listening"}
{"type":"audio_start","format":"ima_adpcm","sampleRate":16000,"samples":32000,"bytes":16000}
```

The UUIDs in `src/config/bleConfig.ts` match `firmware/robo_car/robo_car.ino`.
If you generate your own, change both.

---

## Project structure

```
robo-car/
├── app.json, eas.json, .env.example
├── plugins/withBlePermissions.js   # local config plugin (BLE feature flag, iOS text)
├── modules/robo-tts/               # local native module: text-to-speech → WAV (for the car speaker)
├── firmware/robo_car/robo_car.ino  # ESP32 sketch: BLE, motors, watchdog, speaker
├── scripts/fetch-real-sounds.mjs   # downloads + trims the real animal/laugh recordings
├── scripts/generate-sounds.mjs     # synthesizes robot.wav and beep.wav
├── assets/sounds/                  # soundboard WAVs + CREDITS.md (licences)
├── docs/ESP32_PROTOCOL.md
└── src/
    ├── app/                  # Expo Router routes (thin): _layout.tsx, (tabs)/…
    ├── screens/              # Home, Control, Companion, Sounds, Settings
    ├── components/           # RobotFace, DirectionPad, VoiceButton, ChatBubble,
    │                         # ConnectionStatus, SpeedControl, ui/
    ├── services/
    │   ├── bluetooth/        # bluetoothManager (facade), bleProtocol, deviceScanner,
    │   │                     # connectionManager, blePlxTransport, mockCar
    │   ├── ai/               # AIProvider, OpenAICompatibleProvider, OpenRouter, Groq, AIService, credentials
    │   ├── intent/           # intentRouter, intentTypes, commandValidator, localIntentParser
    │   ├── voice/            # speechToText, textToSpeech, speechSynthesizer, voiceService
    │   ├── audio/            # audioService, audioQueue, soundLibrary, carSpeaker, wav, pcm
    │   ├── car/              # carController (keep-alives, timed moves, stop)
    │   ├── oled/             # oledService (which face to show)
    │   └── assistant/        # assistantService (voice/text → intent → action → reply)
    ├── store/                # Zustand store, service→store bindings, settings persistence
    ├── config/               # bleConfig, aiConfig, safetyConfig, robotConfig (name + system prompt)
    ├── hooks/                # useBluetooth, useCarControl, useVoiceAssistant
    ├── types/                # ai, bluetooth, commands, voice, audio, oled
    ├── theme/  utils/
```

**Layering:** screens → hooks → services. Services never import React or the
store. `store/bindings.ts` copies their events into the Zustand store. BLE,
AI, speech and audio each sit behind an interface and can be swapped
independently.

## Customising

| Want to change… | Edit |
|-----------------|------|
| Robot name | `ROBOT_NAME` in `src/config/robotConfig.ts` |
| Personality / system prompt | `buildSystemPrompt` in the same file |
| BLE UUIDs, device name filter, MTU | `src/config/bleConfig.ts` |
| Speed/duration limits, keep-alive | `src/config/safetyConfig.ts` |
| Sounds | replace files in `assets/sounds/` (same names, 16-bit PCM WAV) or edit `soundLibrary.ts`; `npm run fetch:sounds` re-downloads the recordings |
| Motor/speaker pins, volume | constants at the top of `firmware/robo_car/robo_car.ino` |
| Colours | `src/theme/theme.ts` |

## Development commands

```bash
npm start              # Expo dev server (Expo Go)
npm run start:dev-client
npm run typecheck      # tsc --noEmit (strict)
npm run lint           # expo lint
npm test               # Jest: intent parser, validator, protocol, router, providers, demo car
npm run fetch:sounds    # real animal/laugh recordings (needs ffmpeg)
npm run generate:sounds # synthesized robot + beep
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Bluetooth isn't available in this build" | You're in Expo Go/web. Use the development build or APK. |
| Scan finds nothing | ESP32 on and advertising? Name starts with `Robo`/`ESP32` (or set `SHOW_ALL_DEVICES: true`). Bluetooth on, "Nearby devices" permission allowed. On Android ≤ 11 Location must be on. |
| "service UUID mismatch" | UUIDs in `bleConfig.ts` don't match the firmware. |
| Voice input unavailable | You're in Expo Go, so install the APK. On the APK: the Google app / "Speech Services by Google" must be installed and enabled, and the microphone permission allowed. |
| Hands-free stops by itself | It pauses after 2 minutes of silence, when the app goes to the background, or after repeated recognizer errors (usually no internet). |
| Voice still comes from the phone | Settings → Voice shows why: not connected, APK needed, or the firmware has no audio characteristic (flash `firmware/robo_car`). |
| Car speaker is choppy | Weak BLE link: keep the phone closer. The Serial Monitor prints `dropped … bytes` if the car's buffer overflowed. |
| Car speaker is quiet/distorted | Change `VOLUME_PERCENT` in the sketch, power the MAX98357A from 5 V, add a capacitor across its supply. |
| "No API key set" / "key was rejected" | Settings → AI brain → paste key → Test connection. |
| "model isn't available" | Check the model id on the provider's model list. |

## Not included (by design)

Camera, object detection, autonomous driving, face recognition, GPS, cloud
database, accounts, analytics, multi-car, and a microphone on the car (you
talk to the phone).
