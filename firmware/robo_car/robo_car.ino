/*
 * Robo Car firmware — ESP32, Arduino-ESP32 core 3.x
 *
 * The phone app is the brain (AI, speech recognition, text-to-speech). This
 * sketch:
 *   - exposes the BLE GATT service the app connects to (protocol v2, see
 *     docs/ESP32_PROTOCOL.md),
 *   - drives two BO motors through an L298N,
 *   - plays Robo's voice and sounds on a speaker through a MAX98357A I2S amp
 *     (the app streams IMA ADPCM, 16 kHz mono, over BLE),
 *   - shows Robo's animated face on a 1.3" SH1106 OLED (state sent by the app),
 *   - stops the motors if the app goes quiet (watchdog) or disconnects.
 *
 * Arduino IDE setup:
 *   Boards Manager: "esp32" by Espressif (3.x). Board: "ESP32 Dev Module".
 *   Library Manager: "ArduinoJson" by Benoit Blanchon (v7) and
 *   "Adafruit SH110X" by Adafruit (say "Install all" for Adafruit GFX + BusIO).
 *   Tools → Partition Scheme: "Huge APP (3MB No OTA)" if the sketch is too big.
 *
 * Wiring — ESP32 DevKit V1 (classic ESP32/WROOM):
 *
 *   L298N (ENA/ENB jumpers removed)    MAX98357A           OLED SH1106 (I2C)
 *   ENA → GPIO 25 (left PWM)           BCLK → GPIO 14      SDA → GPIO 21
 *   IN1 → GPIO 26                      LRC  → GPIO 15      SCL → GPIO 23
 *   IN2 → GPIO 27                      DIN  → GPIO 22
 *   ENB → GPIO 13 (right PWM)
 *   IN3 → GPIO 32
 *   IN4 → GPIO 33
 *   GND ↔ ESP32 GND (common ground)
 *
 *   A 100–470 µF capacitor across the amp's VIN/GND helps against motor noise.
 *   Test the motors first with firmware/robo_car_wifi_test.
 */
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>
#include <Arduino.h>
#include <ArduinoJson.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <ESP_I2S.h>
#include <Wire.h>
#include "freertos/ringbuf.h"

// ---------------------------------------------------------------------------
// Must match src/config/bleConfig.ts in the app
// ---------------------------------------------------------------------------
#define DEVICE_NAME  "Robo-Car"
#define SERVICE_UUID "6e400001-0000-4000-8000-00000000c0de"
#define CMD_UUID     "6e400002-0000-4000-8000-00000000c0de"
#define STATUS_UUID  "6e400003-0000-4000-8000-00000000c0de"
#define AUDIO_UUID   "6e400004-0000-4000-8000-00000000c0de"

const uint32_t AUDIO_SAMPLE_RATE = 16000;   // BLE_CONFIG.AUDIO_SAMPLE_RATE
const uint32_t AUDIO_PREBUFFER_MS = 250;    // BLE_CONFIG.AUDIO_PREBUFFER_MS

// ---------------------------------------------------------------------------
// Pins & tuning
// ---------------------------------------------------------------------------
const int LEFT_EN = 25, LEFT_IN1 = 26, LEFT_IN2 = 27;     // L298N motor A
const int RIGHT_EN = 13, RIGHT_IN1 = 32, RIGHT_IN2 = 33;  // L298N motor B
const int I2S_BCLK = 14, I2S_LRC = 15, I2S_DIN = 22;
const int OLED_SDA = 21, OLED_SCL = 23;

// Same values as in firmware/robo_car_wifi_test (motor A is wired reversed on
// this car). With them the app's "forward" really drives forward.
const bool INVERT_LEFT = true;
const bool INVERT_RIGHT = false;

const uint32_t WATCHDOG_MS = 1000;      // stop if no car_command for this long
const uint32_t PWM_FREQ = 1000;         // the L298N is slow; ~1 kHz gives BO motors the most torque
const uint8_t PWM_BITS = 8;
const int MIN_DUTY = 90;                // below this BO motors just hum
const int VOLUME_PERCENT = 80;          // 0–100, lower it if the speaker distorts

// The app stays at most ~1.25 s ahead of playback (8000 bytes/s), so 16 KB is plenty.
const size_t AUDIO_BUFFER_BYTES = 16 * 1024;
const size_t PREBUFFER_BYTES = AUDIO_SAMPLE_RATE / 2 * AUDIO_PREBUFFER_MS / 1000;
const size_t DECODE_CHUNK_BYTES = 128;  // → 256 samples per I2S write

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
// Declared up here because the Arduino IDE adds function prototypes above the
// first function, and adpcmDecode() takes this type.
struct AdpcmState {
  int predictor = 0;
  int index = 0;
};

BLECharacteristic* statusChar = nullptr;
String rxBuffer;
volatile uint32_t lastCommandMs = 0;
volatile bool moving = false;

I2SClass i2s;
RingbufHandle_t audioRing = nullptr;
SemaphoreHandle_t audioRingLock = nullptr;  // serialises ring buffer reads (audio task vs. flush)
volatile bool audioActive = false;          // a clip is being received/played
volatile bool audioEnded = false;           // audio_end received: play out what's buffered
volatile uint32_t audioGeneration = 0;      // bumped on every audio_start / stop
volatile uint32_t audioDropped = 0;         // bytes lost because the buffer was full

// ---------------------------------------------------------------------------
// Motors
// ---------------------------------------------------------------------------
void driveSide(int en, int in1, int in2, int direction, int duty) {
  digitalWrite(in1, direction > 0 ? HIGH : LOW);
  digitalWrite(in2, direction < 0 ? HIGH : LOW);
  ledcWrite(en, direction == 0 ? 0 : duty);
}

void setMotors(const char* cmd, int speedPercent) {
  int percent = constrain(speedPercent, 0, 100);
  int duty = percent == 0 ? 0 : map(percent, 1, 100, MIN_DUTY, (1 << PWM_BITS) - 1);
  int left = 0, right = 0;
  if (!strcmp(cmd, "forward"))       { left = 1;  right = 1; }
  else if (!strcmp(cmd, "backward")) { left = -1; right = -1; }
  else if (!strcmp(cmd, "left"))     { left = -1; right = 1; }   // turn in place
  else if (!strcmp(cmd, "right"))    { left = 1;  right = -1; }
  driveSide(LEFT_EN, LEFT_IN1, LEFT_IN2, INVERT_LEFT ? -left : left, duty);
  driveSide(RIGHT_EN, RIGHT_IN1, RIGHT_IN2, INVERT_RIGHT ? -right : right, duty);
}

void stopMotors() {
  setMotors("stop", 0);
  moving = false;
}

// ---------------------------------------------------------------------------
// OLED face (1.3" SH1106 128×64, I2C) — same faces as the app's preview,
// geometry from src/components/RobotFace (docs/ESP32_PROTOCOL.md §6).
// The BLE callback only records the state; displayTask draws ~25 fps.
// ---------------------------------------------------------------------------
Adafruit_SH1106G display(128, 64, &Wire, -1);
bool displayReady = false;

enum Face : uint8_t { FACE_IDLE, FACE_LISTENING, FACE_THINKING, FACE_SPEAKING, FACE_MOVING, FACE_STOPPED, FACE_ERROR };
volatile uint8_t currentFace = FACE_IDLE;
volatile uint32_t faceSinceMs = 0;
int faceOffsetY = 0;  // "moving" bounce

void showFace(const char* state) {
  uint8_t face = FACE_IDLE;
  if (!strcmp(state, "listening")) face = FACE_LISTENING;
  else if (!strcmp(state, "thinking")) face = FACE_THINKING;
  else if (!strcmp(state, "speaking")) face = FACE_SPEAKING;
  else if (!strcmp(state, "moving")) face = FACE_MOVING;
  else if (!strcmp(state, "stopped")) face = FACE_STOPPED;
  else if (!strcmp(state, "error")) face = FACE_ERROR;
  if (face != currentFace) {
    faceSinceMs = millis();
    currentFace = face;
  }
}

/** Round-capped line `thickness` px wide. */
void thickLine(float x0, float y0, float x1, float y1, int thickness) {
  float length = max(fabsf(x1 - x0), fabsf(y1 - y0));
  int steps = max(1, (int)length);
  int r = thickness / 2;
  for (int i = 0; i <= steps; i++) {
    float t = (float)i / steps;
    int x = lroundf(x0 + (x1 - x0) * t);
    int y = lroundf(y0 + (y1 - y0) * t) + faceOffsetY;
    if (r == 0) display.drawPixel(x, y, SH110X_WHITE);
    else display.fillCircle(x, y, r, SH110X_WHITE);
  }
}

/** Quadratic Bézier stroke (like SVG "M x0 y0 Q cx cy x1 y1"). */
void quadCurve(float x0, float y0, float cx, float cy, float x1, float y1, int thickness) {
  const int SEGMENTS = 16;
  float px = x0, py = y0;
  for (int i = 1; i <= SEGMENTS; i++) {
    float t = (float)i / SEGMENTS, u = 1 - t;
    float x = u * u * x0 + 2 * u * t * cx + t * t * x1;
    float y = u * u * y0 + 2 * u * t * cy + t * t * y1;
    thickLine(px, py, x, y, thickness);
    px = x;
    py = y;
  }
}

void fillEllipse(int cx, int cy, int rx, int ry) {
  cy += faceOffsetY;
  for (int dy = -ry; dy <= ry; dy++) {
    float k = 1.0f - (float)(dy * dy) / (float)(ry * ry);
    int half = lroundf(rx * sqrtf(max(0.0f, k)));
    display.drawFastHLine(cx - half, cy + dy, half * 2 + 1, SH110X_WHITE);
  }
}

/** Eye box scaled around its centre (blink = scaleY, pulse = scale). */
void roundBox(float x, float y, float w, float h, float r, float scale, float scaleY, uint16_t color) {
  float nw = w * scale, nh = max(2.0f, h * scale * scaleY);
  float nx = x + (w - nw) / 2, ny = y + (h - nh) / 2;
  int rr = min((int)r, (int)(min(nw, nh) / 2));
  display.fillRoundRect(lroundf(nx), lroundf(ny) + faceOffsetY, lroundf(nw), lroundf(nh), rr, color);
}

/** 1 normally, ~0.1 for a short blink every `periodMs`. */
float blinkFactor(uint32_t t, uint32_t periodMs) {
  uint32_t p = t % periodMs;
  return (p > periodMs - 180) ? 0.1f : 1.0f;
}

/** Smooth 0→1→0 triangle wave. */
float wave(uint32_t t, uint32_t periodMs) {
  float p = (float)(t % periodMs) / periodMs;
  return p < 0.5f ? p * 2 : (1 - p) * 2;
}

void drawEyes(uint8_t face, uint32_t t) {
  const float EYE_X[2] = {28, 76};
  const float EYE_Y = 14, EYE_W = 24, EYE_H = 24, EYE_R = 6;
  for (int i = 0; i < 2; i++) {
    float x = EYE_X[i];
    switch (face) {
      case FACE_MOVING:  // happy ^
        quadCurve(x + 2, EYE_Y + 18, x + EYE_W / 2, EYE_Y, x + EYE_W - 2, EYE_Y + 18, 4);
        break;
      case FACE_ERROR:  // X
        thickLine(x + 3, EYE_Y + 3, x + EYE_W - 3, EYE_Y + EYE_H - 3, 4);
        thickLine(x + EYE_W - 3, EYE_Y + 3, x + 3, EYE_Y + EYE_H - 3, 4);
        break;
      case FACE_THINKING:  // squint, looking up
        roundBox(x + 3, EYE_Y + 2, EYE_W - 4, 12, 4, 1, blinkFactor(t, 1400), SH110X_WHITE);
        break;
      case FACE_LISTENING: {  // wide, pulsing, with a highlight
        float s = 1 + 0.1f * wave(t, 900);
        roundBox(x, EYE_Y, EYE_W, EYE_H, EYE_R, s, 1, SH110X_WHITE);
        display.fillRect(lroundf(x + 4), lroundf(EYE_Y + 4) + faceOffsetY, 6, 6, SH110X_BLACK);
        break;
      }
      default: {
        uint32_t period = face == FACE_SPEAKING ? 2600 : 3200;
        roundBox(x, EYE_Y, EYE_W, EYE_H, EYE_R, 1, blinkFactor(t, period), SH110X_WHITE);
      }
    }
  }
}

void drawMouth(uint8_t face, uint32_t t) {
  switch (face) {
    case FACE_LISTENING:  // small "o"
      for (int r = 3; r <= 5; r++) display.drawCircle(64, 50 + faceOffsetY, r, SH110X_WHITE);
      break;
    case FACE_SPEAKING: {  // talking mouth: opens and closes
      static const float OPEN[] = {1.0f, 0.3f, 1.0f, 0.55f, 0.9f};
      float open = OPEN[(t / 125) % 5];
      fillEllipse(64, 50, 10, max(1, (int)lroundf(6 * open)));
      break;
    }
    case FACE_MOVING:  // big filled smile: chord at y=44, curve down to y=54
      for (int x = 46; x <= 82; x++) {
        float k = (x - 46) / 36.0f;
        int bottom = lroundf(44 + 20 * k * (1 - k));
        display.drawFastVLine(x, 44 + faceOffsetY, bottom - 44 + 1, SH110X_WHITE);
      }
      break;
    case FACE_STOPPED:  // flat line
      thickLine(53, 50, 75, 50, 3);
      break;
    case FACE_ERROR:  // frown
      quadCurve(52, 55, 64, 44, 76, 55, 3);
      break;
    case FACE_THINKING: {  // three dots lighting up in turn
      uint32_t p = t % 900;
      for (int i = 0; i < 3; i++) {
        bool lit = p >= (uint32_t)i * 180 && p < (uint32_t)i * 180 + 260;
        display.fillCircle(55 + i * 9, 50 + faceOffsetY, lit ? 3 : 1, SH110X_WHITE);
      }
      break;
    }
    default:  // smile
      quadCurve(50, 46, 64, 58, 78, 46, 3);
  }
}

void drawWaveBars(uint32_t t) {
  float s = 0.35f + 0.65f * wave(t, 520);
  const int CENTERS[2] = {11, 117};
  for (int c : CENTERS) {
    int halves[3] = {5, 11, 5};
    for (int i = 0; i < 3; i++) {
      int h = max(1, (int)lroundf(halves[i] * s));
      display.fillRect(c - 6 + i * 5, 32 - h, 2, h * 2, SH110X_WHITE);
    }
  }
}

void displayTask(void*) {
  uint8_t shownFace = 0xFF;
  for (;;) {
    uint8_t face = currentFace;
    uint32_t t = millis() - faceSinceMs;
    if (face != shownFace) {
      display.setContrast(0xFF);
      shownFace = face;
    }
    faceOffsetY = face == FACE_MOVING ? -(int)lroundf(2 * wave(t, 440)) : 0;
    if (face == FACE_ERROR) display.setContrast((t / 280) % 2 ? 0x20 : 0xFF);  // flashing

    display.clearDisplay();
    drawEyes(face, t);
    drawMouth(face, t);
    if (face == FACE_LISTENING) drawWaveBars(t);
    display.display();
    vTaskDelay(pdMS_TO_TICKS(40));
  }
}

bool beginDisplay() {
  Wire.begin(OLED_SDA, OLED_SCL);
  Wire.setClock(400000);
  const uint8_t ADDRESSES[] = {0x3C, 0x3D};
  for (uint8_t address : ADDRESSES) {
    if (display.begin(address, true)) {
      Serial.printf("[oled] SH1106 found at 0x%02X\n", address);
      display.clearDisplay();
      display.display();
      return true;
    }
  }
  Serial.println("[oled] no display at 0x3C/0x3D — check SDA 21 / SCL 23 / power");
  return false;
}

// ---------------------------------------------------------------------------
// Status notifications
// ---------------------------------------------------------------------------
void notify(const char* state, const char* cmd, int speed, const char* msg = nullptr) {
  if (!statusChar) return;
  JsonDocument doc;
  doc["type"] = "status";
  doc["state"] = state;
  doc["command"] = cmd;
  doc["speed"] = speed;
  if (msg) doc["message"] = msg;
  String out;
  serializeJson(doc, out);
  out += '\n';
  statusChar->setValue((uint8_t*)out.c_str(), out.length());
  statusChar->notify();
}

// ---------------------------------------------------------------------------
// Audio: ring buffer → IMA ADPCM decoder → I2S → MAX98357A
// ---------------------------------------------------------------------------
static const int16_t ADPCM_STEP[89] = {
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107,
  118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
  1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894,
  6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
  32767};
static const int8_t ADPCM_INDEX[16] = {-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8};

// Must match decodeImaAdpcm() in src/services/audio/pcm.ts.
int16_t adpcmDecode(AdpcmState& s, uint8_t code) {
  int step = ADPCM_STEP[s.index];
  int diff = step >> 3;
  if (code & 4) diff += step;
  if (code & 2) diff += step >> 1;
  if (code & 1) diff += step >> 2;
  s.predictor += (code & 8) ? -diff : diff;
  s.predictor = constrain(s.predictor, -32768, 32767);
  s.index = constrain(s.index + ADPCM_INDEX[code], 0, 88);
  return (int16_t)s.predictor;
}

size_t audioBuffered() {
  return AUDIO_BUFFER_BYTES - xRingbufferGetCurFreeSize(audioRing);
}

/** Drops everything buffered. Safe from any task. */
void flushAudio() {
  xSemaphoreTake(audioRingLock, portMAX_DELAY);
  size_t size;
  void* item;
  while ((item = xRingbufferReceiveUpTo(audioRing, &size, 0, AUDIO_BUFFER_BYTES)) != nullptr) {
    vRingbufferReturnItem(audioRing, item);
  }
  xSemaphoreGive(audioRingLock);
}

void writeSilence(uint32_t ms) {
  static int16_t zeros[256 * 2] = {0};
  uint32_t frames = AUDIO_SAMPLE_RATE * ms / 1000;
  while (frames > 0) {
    uint32_t n = min<uint32_t>(frames, 256);
    i2s.write((uint8_t*)zeros, n * 2 * sizeof(int16_t));
    frames -= n;
  }
}

void startAudio(uint32_t samples, uint32_t bytes) {
  audioActive = false;
  audioGeneration = audioGeneration + 1;
  flushAudio();
  audioEnded = false;
  audioDropped = 0;
  audioActive = true;
  Serial.printf("[audio] start %lu samples, %lu bytes\n", (unsigned long)samples, (unsigned long)bytes);
}

void stopAudio() {
  audioActive = false;
  audioGeneration = audioGeneration + 1;
  flushAudio();
}

void audioTask(void*) {
  static int16_t frames[DECODE_CHUNK_BYTES * 2 * 2];  // 2 samples per byte, stereo
  AdpcmState decoder;
  uint32_t generation = audioGeneration;
  bool playing = false;
  bool wasActive = false;

  for (;;) {
    if (generation != audioGeneration) {  // new clip or stop: reset the decoder
      generation = audioGeneration;
      decoder = AdpcmState();
      playing = false;
      if (wasActive) writeSilence(40);  // clear the DMA buffers so nothing loops
      wasActive = false;
    }
    if (!audioActive) {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }
    wasActive = true;

    // Wait for a little audio first (and again after an underrun) so playback is smooth.
    if (!playing) {
      size_t buffered = audioBuffered();
      if (buffered >= PREBUFFER_BYTES || (audioEnded && buffered > 0)) {
        playing = true;
      } else if (audioEnded) {
        if (generation == audioGeneration) audioActive = false;  // nothing left to play
        continue;
      } else {
        vTaskDelay(pdMS_TO_TICKS(5));
        continue;
      }
    }

    xSemaphoreTake(audioRingLock, portMAX_DELAY);
    size_t size = 0;
    uint8_t* data = (uint8_t*)xRingbufferReceiveUpTo(audioRing, &size, pdMS_TO_TICKS(20), DECODE_CHUNK_BYTES);
    size_t count = 0;
    if (data) {
      for (size_t i = 0; i < size; i++) {
        int16_t a = adpcmDecode(decoder, data[i] & 0x0F);
        int16_t b = adpcmDecode(decoder, data[i] >> 4);
        a = (int32_t)a * VOLUME_PERCENT / 100;
        b = (int32_t)b * VOLUME_PERCENT / 100;
        frames[count++] = a;  // left
        frames[count++] = a;  // right
        frames[count++] = b;
        frames[count++] = b;
      }
      vRingbufferReturnItem(audioRing, data);
    }
    xSemaphoreGive(audioRingLock);

    if (count > 0) {
      if (generation == audioGeneration) i2s.write((uint8_t*)frames, count * sizeof(int16_t));
    } else if (audioEnded) {
      writeSilence(40);
      if (generation == audioGeneration) audioActive = false;  // clip finished
      if (audioDropped) Serial.printf("[audio] dropped %lu bytes (buffer full)\n", (unsigned long)audioDropped);
    } else {
      playing = false;  // underrun: BLE is behind, rebuffer
    }
  }
}

// ---------------------------------------------------------------------------
// BLE
// ---------------------------------------------------------------------------
void handleFrame(const String& frame) {
  JsonDocument doc;
  if (deserializeJson(doc, frame)) {
    notify("error", "stop", 0, "bad json");
    return;
  }
  const char* type = doc["type"] | "";

  if (!strcmp(type, "car_command")) {
    const char* cmd = doc["command"] | "";
    if (!strcmp(cmd, "stop")) {
      stopMotors();
      notify("stopped", "stop", 0);
      return;
    }
    int speed = doc["speed"] | -1;
    bool known = !strcmp(cmd, "forward") || !strcmp(cmd, "backward") || !strcmp(cmd, "left") || !strcmp(cmd, "right");
    if (!known) { notify("error", "stop", 0, "unknown command"); return; }
    if (speed < 0 || speed > 100) { notify("error", "stop", 0, "bad speed"); return; }
    lastCommandMs = millis();
    if (!moving) notify("moving", cmd, speed);
    moving = true;
    setMotors(cmd, speed);
  } else if (!strcmp(type, "oled")) {
    showFace(doc["state"] | "idle");
  } else if (!strcmp(type, "audio_start")) {
    const char* format = doc["format"] | "";
    uint32_t rate = doc["sampleRate"] | 0;
    if (strcmp(format, "ima_adpcm") != 0 || rate != AUDIO_SAMPLE_RATE) {
      stopAudio();
      notify("error", "stop", 0, "bad audio format");
      return;
    }
    startAudio(doc["samples"] | 0, doc["bytes"] | 0);
  } else if (!strcmp(type, "audio_end")) {
    audioEnded = true;
  } else if (!strcmp(type, "audio_stop")) {
    stopAudio();
  }
}

class CmdCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    rxBuffer += c->getValue();
    if (rxBuffer.length() > 256) rxBuffer = "";  // garbage / missing terminator
    int nl;
    while ((nl = rxBuffer.indexOf('\n')) >= 0) {
      handleFrame(rxBuffer.substring(0, nl));
      rxBuffer.remove(0, nl + 1);
    }
  }
};

class AudioCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    if (!audioActive) return;
    // Binary data: use getData/getLength, not getValue (it stops at 0 bytes).
    size_t length = c->getLength();
    if (length == 0) return;
    if (xRingbufferSend(audioRing, c->getData(), length, 0) != pdTRUE) audioDropped = audioDropped + length;
  }
};

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    Serial.println("[ble] connected");
  }
  void onDisconnect(BLEServer* server) override {
    Serial.println("[ble] disconnected — stopping");
    stopMotors();
    stopAudio();
    showFace("idle");
    rxBuffer = "";
    server->startAdvertising();
  }
};

// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);

  pinMode(LEFT_IN1, OUTPUT);
  pinMode(LEFT_IN2, OUTPUT);
  pinMode(RIGHT_IN1, OUTPUT);
  pinMode(RIGHT_IN2, OUTPUT);
  ledcAttach(LEFT_EN, PWM_FREQ, PWM_BITS);
  ledcAttach(RIGHT_EN, PWM_FREQ, PWM_BITS);
  stopMotors();  // start stopped

  audioRing = xRingbufferCreate(AUDIO_BUFFER_BYTES, RINGBUF_TYPE_BYTEBUF);
  audioRingLock = xSemaphoreCreateMutex();
  i2s.setPins(I2S_BCLK, I2S_LRC, I2S_DIN);
  if (!i2s.begin(I2S_MODE_STD, AUDIO_SAMPLE_RATE, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO)) {
    Serial.println("[audio] I2S init failed — check the pins");
  }
  writeSilence(50);
  xTaskCreatePinnedToCore(audioTask, "audio", 4096, nullptr, 2, nullptr, 1);

  displayReady = beginDisplay();
  if (displayReady) xTaskCreatePinnedToCore(displayTask, "oled", 4096, nullptr, 1, nullptr, 1);

  BLEDevice::init(DEVICE_NAME);
  BLEDevice::setMTU(247);  // the app asks for 185; bigger writes = smoother audio
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  BLEService* service = server->createService(SERVICE_UUID);

  BLECharacteristic* cmd = service->createCharacteristic(
      CMD_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  cmd->setCallbacks(new CmdCallbacks());

  statusChar = service->createCharacteristic(
      STATUS_UUID, BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_READ);
#if defined(CONFIG_BLUEDROID_ENABLED)
  statusChar->addDescriptor(new BLE2902());  // NimBLE adds this automatically
#endif

  BLECharacteristic* audio = service->createCharacteristic(
      AUDIO_UUID, BLECharacteristic::PROPERTY_WRITE_NR | BLECharacteristic::PROPERTY_WRITE);
  audio->setCallbacks(new AudioCallbacks());

  service->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
  showFace("idle");
  Serial.println("[ble] advertising as " DEVICE_NAME);
}

void loop() {
  if (moving && millis() - lastCommandMs > WATCHDOG_MS) {
    stopMotors();
    notify("stopped", "stop", 0, "watchdog");
  }
  delay(20);
}
