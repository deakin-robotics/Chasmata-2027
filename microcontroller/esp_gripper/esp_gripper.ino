#include <Arduino.h>
#include <ESP32Servo.h>
 
// ---------------- PINS ----------------
#define LASER_PIN 12
#define SERVO_PIN 13
 
// ---------------- SERVO LIMITS ----------------
const int MIN_ANGLE = 104;
const int MAX_ANGLE = 137;
 
Servo myServo;
 
int currentAngle = 137;
int targetAngle  = 137;
const int stepDelay = 20;  // fixed
 
bool laserState = false;
 
unsigned long lastStepTime = 0;
 
// ---------------- SERIAL ----------------
String inputString = "";
bool stringComplete = false;
 
// ---------------- SETUP ----------------
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== ESP32 SERIAL Servo Node ===");
 
  myServo.setPeriodHertz(50);
  myServo.attach(SERVO_PIN, 500, 2400);
  myServo.write(currentAngle);
 
  pinMode(LASER_PIN, OUTPUT);
  digitalWrite(LASER_PIN, LOW);
}
 
// ---------------- LOOP ----------------
void loop() {
  unsigned long now = millis();
 
  // -------- SERIAL READ --------
  while (Serial.available()) {
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
    int val = inputString.toInt();
 
    // ----- LASER -----
    if (val == 0) {
      laserState = false;
      digitalWrite(LASER_PIN, LOW);
      Serial.println("Laser OFF");
    }
    else if (val == 1) {
      laserState = true;
      digitalWrite(LASER_PIN, HIGH);
      Serial.println("Laser ON");
    }
    // ----- SERVO -----
    else if (val >= MIN_ANGLE && val <= MAX_ANGLE) {
      targetAngle = val;
      Serial.printf("Target angle: %d\n", targetAngle);
    }
    else {
      Serial.println("Invalid input");
    }
 
    inputString = "";
    stringComplete = false;
  }
 
  // -------- SERVO SMOOTH MOVE --------
  if (currentAngle != targetAngle && (now - lastStepTime >= stepDelay)) {
    lastStepTime = now;
 
    if (currentAngle < targetAngle) currentAngle++;
    else if (currentAngle > targetAngle) currentAngle--;
 
    myServo.write(currentAngle);
  }
}