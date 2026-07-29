#include <Arduino.h>
#include <Wire.h>

#include <Adafruit_BME280.h>
#include <ArduinoJson.h>
#include <BLE2902.h>
#include <BLEAdvertising.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <ESP32Servo.h>

// ---------------------------------------------------------------------------
// 두더지 XIAO ESP32S3: BLE 센서/제어 펌웨어
//
// 데이터 경로:
//   BME280·리드 스위치 -> XIAO -> BLE Notification -> 노트북/라즈베리파이
//   노트북/라즈베리파이 -> BLE Write -> XIAO -> 서보·릴레이
//
// 이 펌웨어는 Wi-Fi와 WebSocket을 사용하지 않습니다.
// ---------------------------------------------------------------------------

namespace Dudeoji {

constexpr char BLE_DEVICE_NAME[] = "DUDEOJI-XIAO";

// 아래 UUID는 dudeoji-gateway/protocol.py와 반드시 같아야 합니다.
constexpr char SERVICE_UUID[] =
    "7d2ea28a-f7bd-485a-bd9d-92ad6ecfe93e";
constexpr char SENSOR_CHARACTERISTIC_UUID[] =
    "7d2ea28b-f7bd-485a-bd9d-92ad6ecfe93e";
constexpr char CONTROL_CHARACTERISTIC_UUID[] =
    "7d2ea28c-f7bd-485a-bd9d-92ad6ecfe93e";
constexpr char RESULT_CHARACTERISTIC_UUID[] =
    "7d2ea28d-f7bd-485a-bd9d-92ad6ecfe93e";

// XIAO ESP32S3 핀 계획
constexpr uint8_t SERVO_PIN = D0;
constexpr uint8_t RELAY_PIN = D1;
constexpr uint8_t REED_PIN = D2;
constexpr uint8_t SDA_PIN = D4;
constexpr uint8_t SCL_PIN = D5;
constexpr uint8_t MANUAL_BUTTON_PIN = D8;

// 릴레이 모듈이 LOW 신호에서 켜지는 일반적인 형태를 기본값으로 사용합니다.
// 실제 모듈이 HIGH 신호에서 켜지면 false로 변경하세요.
constexpr bool RELAY_ACTIVE_LOW = true;

constexpr int WINDOW_CLOSED_ANGLE = 20;
constexpr int WINDOW_OPEN_ANGLE = 100;

constexpr unsigned long SENSOR_INTERVAL_MS = 5000;
constexpr unsigned long BUTTON_DEBOUNCE_MS = 50;
constexpr unsigned long BLE_READVERTISE_DELAY_MS = 500;

// BME280 연결을 해결하기 전 BLE 왕복만 시험할 때 true로 바꾸면
// 25.0°C / 50.0% 가짜값을 전송합니다. 최종 시연에서는 반드시 false입니다.
constexpr bool DEMO_USE_FAKE_BME = false;

}  // namespace Dudeoji

Adafruit_BME280 bme;
Servo windowServo;

BLEServer* bleServer = nullptr;
BLECharacteristic* sensorCharacteristic = nullptr;
BLECharacteristic* resultCharacteristic = nullptr;

volatile bool bleConnected = false;
bool wasBleConnected = false;
bool bmeAvailable = false;
bool fanOn = false;
volatile bool forceSensorPublish = true;

unsigned long lastSensorPublishAt = 0;
unsigned long disconnectedAt = 0;

bool lastButtonReading = HIGH;
bool stableButtonState = HIGH;
unsigned long lastButtonChangeAt = 0;

int relayOnLevel() {
  return Dudeoji::RELAY_ACTIVE_LOW ? LOW : HIGH;
}

int relayOffLevel() {
  return Dudeoji::RELAY_ACTIVE_LOW ? HIGH : LOW;
}

bool readWindowOpen() {
  // N.O. 리드 스위치를 INPUT_PULLUP으로 사용:
  // 자석이 가까워 접점이 닫히면 LOW = 창문 닫힘
  return digitalRead(Dudeoji::REED_PIN) == HIGH;
}

void setFan(bool enabled) {
  fanOn = enabled;
  digitalWrite(
      Dudeoji::RELAY_PIN,
      enabled ? relayOnLevel() : relayOffLevel());
}

void setWindowPosition(bool open) {
  windowServo.write(
      open ? Dudeoji::WINDOW_OPEN_ANGLE : Dudeoji::WINDOW_CLOSED_ANGLE);
}

bool initializeBme280() {
  Wire.begin(Dudeoji::SDA_PIN, Dudeoji::SCL_PIN);

  if (bme.begin(0x76, &Wire)) {
    Serial.println("[BME280] 연결 성공: 0x76");
    return true;
  }

  if (bme.begin(0x77, &Wire)) {
    Serial.println("[BME280] 연결 성공: 0x77");
    return true;
  }

  Serial.println("[BME280] 찾지 못함: 0x76/0x77");
  return false;
}

void notifyJson(BLECharacteristic* characteristic, JsonDocument& doc) {
  if (!bleConnected || characteristic == nullptr) {
    return;
  }

  String payload;
  serializeJson(doc, payload);

  characteristic->setValue(payload.c_str());
  characteristic->notify();

  Serial.print("[BLE TX] ");
  Serial.println(payload);
}

void publishSensorReading() {
  JsonDocument doc;
  doc["type"] = "sensor";
  doc["window_open"] = readWindowOpen();
  doc["fan_on"] = fanOn;
  doc["bme_ok"] = bmeAvailable;

  if (bmeAvailable) {
    const float temperature = bme.readTemperature();
    const float humidity = bme.readHumidity();

    if (isfinite(temperature) && isfinite(humidity)) {
      doc["temperature"] = roundf(temperature * 10.0f) / 10.0f;
      doc["humidity"] = roundf(humidity * 10.0f) / 10.0f;
    } else {
      doc["bme_ok"] = false;
      doc["temperature"] = nullptr;
      doc["humidity"] = nullptr;
    }
  } else if (Dudeoji::DEMO_USE_FAKE_BME) {
    doc["bme_ok"] = true;
    doc["temperature"] = 25.0;
    doc["humidity"] = 50.0;
  } else {
    doc["temperature"] = nullptr;
    doc["humidity"] = nullptr;
  }

  notifyJson(sensorCharacteristic, doc);
  lastSensorPublishAt = millis();
  forceSensorPublish = false;
}

void publishCommandResult(
    const String& commandId,
    const String& action,
    bool success,
    const char* detail) {
  JsonDocument doc;
  doc["type"] = "result";
  doc["command_id"] = commandId;
  doc["action"] = action;
  doc["success"] = success;
  doc["detail"] = detail;

  notifyJson(resultCharacteristic, doc);
}

void handleControlCommand(const String& rawPayload) {
  JsonDocument doc;
  const DeserializationError error = deserializeJson(doc, rawPayload);

  if (error) {
    Serial.print("[BLE RX] JSON 오류: ");
    Serial.println(error.c_str());
    publishCommandResult("", "", false, "invalid_json");
    return;
  }

  const String commandId = doc["command_id"] | "";
  const String action = doc["action"] | "";

  Serial.print("[BLE RX] command_id=");
  Serial.print(commandId);
  Serial.print(", action=");
  Serial.println(action);

  if (commandId.length() == 0 || action.length() == 0) {
    publishCommandResult(
        commandId,
        action,
        false,
        "missing_command_id_or_action");
    return;
  }

  if (action == "OPEN_WINDOW") {
    setWindowPosition(true);
    publishCommandResult(
        commandId,
        action,
        true,
        "servo_open_commanded");
  } else if (action == "CLOSE_WINDOW") {
    setWindowPosition(false);
    publishCommandResult(
        commandId,
        action,
        true,
        "servo_close_commanded");
  } else if (action == "TURN_ON_AIRCON") {
    setFan(true);
    publishCommandResult(
        commandId,
        action,
        true,
        "fan_turned_on");
  } else if (action == "TURN_OFF_AIRCON") {
    setFan(false);
    publishCommandResult(
        commandId,
        action,
        true,
        "fan_turned_off");
  } else {
    publishCommandResult(
        commandId,
        action,
        false,
        "unsupported_action");
    return;
  }

  // 실제 리드·릴레이 상태가 서버와 웹에 곧바로 반영되도록 다음 loop에서
  // 센서값을 한 번 더 보냅니다.
  forceSensorPublish = true;
}

class DudeojiServerCallbacks : public BLEServerCallbacks {
 public:
  void onConnect(BLEServer* server) override {
    bleConnected = true;
    forceSensorPublish = true;
    Serial.println("[BLE] 게이트웨이 연결됨");
  }

  void onDisconnect(BLEServer* server) override {
    bleConnected = false;
    disconnectedAt = millis();
    Serial.println("[BLE] 게이트웨이 연결 끊김");
  }
};

class DudeojiControlCallbacks : public BLECharacteristicCallbacks {
 public:
  void onWrite(BLECharacteristic* characteristic) override {
    const String value = characteristic->getValue();
    if (value.length() > 0) {
      handleControlCommand(value);
    }
  }
};

void initializeBle() {
  BLEDevice::init(Dudeoji::BLE_DEVICE_NAME);
  BLEDevice::setMTU(247);

  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new DudeojiServerCallbacks());

  BLEService* service =
      bleServer->createService(Dudeoji::SERVICE_UUID);

  sensorCharacteristic = service->createCharacteristic(
      Dudeoji::SENSOR_CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_READ |
          BLECharacteristic::PROPERTY_NOTIFY);
  sensorCharacteristic->addDescriptor(new BLE2902());

  BLECharacteristic* controlCharacteristic =
      service->createCharacteristic(
          Dudeoji::CONTROL_CHARACTERISTIC_UUID,
          BLECharacteristic::PROPERTY_WRITE);
  controlCharacteristic->setCallbacks(new DudeojiControlCallbacks());

  resultCharacteristic = service->createCharacteristic(
      Dudeoji::RESULT_CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_NOTIFY);
  resultCharacteristic->addDescriptor(new BLE2902());

  service->start();

  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(Dudeoji::SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->setMinPreferred(0x06);
  advertising->setMinPreferred(0x12);
  advertising->start();

  Serial.print("[BLE] Advertising 시작: ");
  Serial.println(Dudeoji::BLE_DEVICE_NAME);
}

void handleManualButton() {
  const bool reading = digitalRead(Dudeoji::MANUAL_BUTTON_PIN);

  if (reading != lastButtonReading) {
    lastButtonChangeAt = millis();
    lastButtonReading = reading;
  }

  if (
      millis() - lastButtonChangeAt >= Dudeoji::BUTTON_DEBOUNCE_MS &&
      reading != stableButtonState) {
    stableButtonState = reading;

    if (stableButtonState == LOW) {
      setFan(!fanOn);
      forceSensorPublish = true;
      Serial.print("[BUTTON] 팬 상태: ");
      Serial.println(fanOn ? "ON" : "OFF");
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("================================");
  Serial.println("두더지 XIAO BLE 펌웨어 시작");
  Serial.println("================================");

  // 부팅 중 릴레이가 순간적으로 켜지지 않도록 OFF 값을 먼저 기록합니다.
  digitalWrite(Dudeoji::RELAY_PIN, relayOffLevel());
  pinMode(Dudeoji::RELAY_PIN, OUTPUT);
  setFan(false);

  pinMode(Dudeoji::REED_PIN, INPUT_PULLUP);
  pinMode(Dudeoji::MANUAL_BUTTON_PIN, INPUT_PULLUP);

  windowServo.setPeriodHertz(50);
  windowServo.attach(Dudeoji::SERVO_PIN, 500, 2400);
  setWindowPosition(false);

  bmeAvailable = initializeBme280();
  initializeBle();
}

void loop() {
  handleManualButton();

  if (
      bleConnected &&
      (forceSensorPublish ||
       millis() - lastSensorPublishAt >= Dudeoji::SENSOR_INTERVAL_MS)) {
    publishSensorReading();
  }

  if (
      !bleConnected &&
      wasBleConnected &&
      millis() - disconnectedAt >= Dudeoji::BLE_READVERTISE_DELAY_MS) {
    bleServer->startAdvertising();
    wasBleConnected = false;
    Serial.println("[BLE] Advertising 재시작");
  }

  if (bleConnected && !wasBleConnected) {
    wasBleConnected = true;
  }

  delay(5);
}
