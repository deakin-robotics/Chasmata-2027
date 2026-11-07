#include <FastLED.h>
#include <ESP32Servo.h>
#include <esp_now.h>
#include <WiFi.h>

#define NUM_LEDS 209
#define LED_PIN 17
#define SERVO_PIN 18
#define START_POS 960
#define FRONT_POS 1960

const int MIN_ANGLE = 104;
const int MAX_ANGLE = 137;

// ESP-NOW
uint8_t receiverMAC[] = {0xb0,0xcb,0xd8,0xc3,0x11,0x48}; // ESP32 #2 MAC

// Antenna servo
Servo pwm;
unsigned int pwm_pos = START_POS;
unsigned long lastToggleTime = 0;
const int cooldown = 5000;

// LEDs
CRGB leds[NUM_LEDS];
int i = 0;
bool filled = false;

// Serial input
String inputString = "";
bool stringComplete = false;

void setup() {
  // LEDs
  FastLED.addLeds<WS2812B, LED_PIN, GRB>(leds, NUM_LEDS);
  FastLED.setBrightness(80);

  // Serial
  Serial.begin(115200);

  // Servo
  ESP32PWM::allocateTimer(0);
  pwm.setPeriodHertz(50);
  pwm.attach(SERVO_PIN, 500, 2500);
  slowMove(START_POS);
  Serial.println("antenna servo READY");

  // ESP-NOW setup
  WiFi.mode(WIFI_STA);
  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW init failed");
    return;
  }
  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, receiverMAC, 6);
  peerInfo.channel = 0;
  peerInfo.encrypt = false;
  esp_now_add_peer(&peerInfo);

  Serial.println("espnow READY");
}

void loop() {
  // Fill LEDs one by one
  if (!filled) {
    if (i < NUM_LEDS) {
      leds[i] = CRGB(255, 100, 0);
      FastLED.show();
      i++;
    } else {
      filled = true;
    }
    return;
  }

  // --- SERIAL READ ---
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\n') {
      stringComplete = true;
      break;
    } else {
      inputString += c;
    }
  }

  if (stringComplete) {
    inputString.trim();

    unsigned long now = millis();
    char cmd = inputString[0];

    // --- Case 1: Antenna commands ---
    if ((cmd == 'F' || cmd == 'f') && (now - lastToggleTime > cooldown)) {
      if (pwm_pos != FRONT_POS) {
        pwm_pos = FRONT_POS;
        slowMove(pwm_pos);
        Serial.println("STATUS:AT_FRONT");
      }
    } else if ((cmd == 'D' || cmd == 'd') && (now - lastToggleTime > cooldown)) {
      pwm_pos -= 10;
      slowMove(pwm_pos);
      Serial.println("STATUS:ADJUST_DOWN");
    } else if ((cmd == 'U' || cmd == 'u') && (now - lastToggleTime > cooldown)) {
      pwm_pos += 10;
      slowMove(pwm_pos);
      Serial.println("STATUS:ADJUST_UP");
    } else if ((cmd == 'S' || cmd == 's') && (now - lastToggleTime > cooldown)) {
      if (pwm_pos != START_POS) {
        pwm_pos = START_POS;
        slowMove(pwm_pos);
        Serial.println("STATUS:AT_START");
      }
    } 
    // --- Case 2: Gripper numeric angle ---
    else {
      int val = inputString.toInt();
      if (val >= MIN_ANGLE && val <= MAX_ANGLE) {
        Serial.printf("Target angle: %d\n", val);

        // Send via ESP-NOW
        esp_now_send(receiverMAC, (uint8_t*)&val, sizeof(val));
        Serial.printf("Sent angle via ESP-NOW: %d\n", val);
      } else {
        Serial.println("Invalid input");
      }
    }

    inputString = "";
    stringComplete = false;
    lastToggleTime = millis();
  }
}

void slowMove(int target) {
  static int currentPos = START_POS;
  int step = (target > currentPos) ? 5 : -5;

  while (abs(currentPos - target) > 5) {
    currentPos += step;
    pwm.writeMicroseconds(currentPos);
    delay(15);
  }
  pwm.writeMicroseconds(target);
  currentPos = target;
}