#include <Arduino.h>
#include <Wire.h>

#include <Adafruit_INA219.h>
#include <ArduinoJson.h>
#include <BLE2902.h>
#include <BLEAdvertising.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <ESP32Servo.h>

// ---------------------------------------------------------------------------
// ESP-CONTROL: 리드 스위치 + 서보 + 릴레이/팬 + INA219
//
// 데이터 경로:
//   리드·릴레이·INA219 -> BLE Notification -> Raspberry Pi 게이트웨이
//   Raspberry Pi 게이트웨이 -> BLE Write -> 서보·릴레이/팬
//
// 중요: 팬과 서보 전원은 XIAO 핀이 아닌 외부 전원에서 공급해야 합니다.
// XIAO, 서보, 릴레이/팬, INA219 전원의 GND는 공통으로 연결합니다.
// ---------------------------------------------------------------------------

namespace DudeojiControl {

constexpr char BLE_DEVICE_NAME[] = "DUDEOJI-CONTROL";
constexpr char DEVICE_ID[] = "control-01";

// dudeoji-gateway/protocol.py와 같은 UUID를 사용합니다.
constexpr char SERVICE_UUID[] =
    "7d2ea28a-f7bd-485a-bd9d-92ad6ecfe93e";
constexpr char SENSOR_CHARACTERISTIC_UUID[] =
    "7d2ea28b-f7bd-485a-bd9d-92ad6ecfe93e";
constexpr char CONTROL_CHARACTERISTIC_UUID[] =
    "7d2ea28c-f7bd-485a-bd9d-92ad6ecfe93e";
constexpr char RESULT_CHARACTERISTIC_UUID[] =
    "7d2ea28d-f7bd-485a-bd9d-92ad6ecfe93e";

constexpr uint8_t SERVO_PIN = D0;
constexpr uint8_t RELAY_PIN = D1;
constexpr uint8_t REED_PIN = D2;
constexpr uint8_t INA_SDA_PIN = D4;
constexpr uint8_t INA_SCL_PIN = D5;
constexpr uint8_t MANUAL_BUTTON_PIN = D8;

// 일반적인 LOW 트리거 릴레이 모듈 기준입니다.
// 사용하는 모듈이 HIGH 트리거라면 false로 변경하세요.
constexpr bool RELAY_ACTIVE_LOW = true;

constexpr int WINDOW_CLOSED_ANGLE = 20;
constexpr int WINDOW_OPEN_ANGLE = 100;

constexpr unsigned long PUBLISH_INTERVAL_MS = 5000;
constexpr unsigned long BUTTON_DEBOUNCE_MS = 50;
constexpr unsigned long BLE_READVERTISE_DELAY_MS = 500;

}  // namespace DudeojiControl

Adafruit_INA219 ina219;
Servo windowServo;

BLEServer* bleServer = nullptr;
BLECharacteristic* stateCharacteristic = nullptr;
BLECharacteristic* resultCharacteristic = nullptr;

volatile bool bleConnected = false;
bool wasBleConnected = false;
bool inaAvailable = false;
bool fanOn = false;
volatile bool forcePublish = true;

unsigned long lastPublishAt = 0;
unsigned long disconnectedAt = 0;

bool lastButtonReading = HIGH;
bool stableButtonState = HIGH;
unsigned long lastButtonChangeAt = 0;

int relayOnLevel() {
  return DudeojiControl::RELAY_ACTIVE_LOW ? LOW : HIGH;
}

int relayOffLevel() {
  return DudeojiControl::RELAY_ACTIVE_LOW ? HIGH : LOW;
}

bool readWindowOpen() {
  // N.O. 리드 스위치 + INPUT_PULLUP:
  // 자석이 가까워 접점이 닫히면 LOW = 창문 닫힘입니다.
  return digitalRead(DudeojiControl::REED_PIN) == HIGH;
}

void setFan(bool enabled) {
  fanOn = enabled;
  digitalWrite(
      DudeojiControl::RELAY_PIN,
      enabled ? relayOnLevel() : relayOffLevel());
}

void setWindowPosition(bool open) {
  windowServo.write(
      open
          ? DudeojiControl::WINDOW_OPEN_ANGLE
          : DudeojiControl::WINDOW_CLOSED_ANGLE);
}

bool initializeIna219() {
  Wire.begin(
      DudeojiControl::INA_SDA_PIN,
      DudeojiControl::INA_SCL_PIN);

  if (!ina219.begin(&Wire)) {
    Serial.println(
        "[INA219] 초기화 실패 - 창문·팬 제어는 계속 동작합니다.");
    return false;
  }

  ina219.setCalibration_32V_2A();
  Serial.println("[INA219] 연결 성공");
  return true;
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

void publishControlState() {
  JsonDocument doc;
  doc["type"] = "control_state";
  doc["device_id"] = DudeojiControl::DEVICE_ID;
  doc["window_open"] = readWindowOpen();
  doc["fan_on"] = fanOn;

  float busVoltage = NAN;
  float currentMa = NAN;
  float powerWatt = NAN;
  bool measurementValid = false;

  if (inaAvailable) {
    busVoltage = ina219.getBusVoltage_V();
    currentMa = ina219.getCurrent_mA();
    powerWatt = ina219.getPower_mW() / 1000.0f;
    measurementValid =
        isfinite(busVoltage) &&
        isfinite(currentMa) &&
        isfinite(powerWatt);
  }

  doc["ina_available"] = inaAvailable && measurementValid;
  if (inaAvailable && measurementValid) {
    doc["bus_voltage"] = roundf(busVoltage * 100.0f) / 100.0f;
    doc["current_ma"] = roundf(currentMa * 10.0f) / 10.0f;
    doc["power_watt"] = roundf(powerWatt * 100.0f) / 100.0f;
  } else {
    doc["bus_voltage"] = nullptr;
    doc["current_ma"] = nullptr;
    doc["power_watt"] = nullptr;
  }

  notifyJson(stateCharacteristic, doc);
  lastPublishAt = millis();
  forcePublish = false;
}

void publishCommandResult(
    const String& commandId,
    const String& action,
    bool success,
    const char* detail) {
  JsonDocument doc;
  doc["type"] = "result";
  doc["device_id"] = DudeojiControl::DEVICE_ID;
  doc["command_id"] = commandId;
  doc["action"] = action;
  doc["success"] = success;
  doc["detail"] = detail;

  notifyJson(resultCharacteristic, doc);
}

void handleControlCommand(const String& rawPayload) {
  JsonDocument doc;
  const DeserializationError error =
      deserializeJson(doc, rawPayload);

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

  forcePublish = true;
}

class ControlServerCallbacks : public BLEServerCallbacks {
 public:
  void onConnect(BLEServer* server) override {
    bleConnected = true;
    forcePublish = true;
    Serial.println("[BLE] 게이트웨이 연결됨");
  }

  void onDisconnect(BLEServer* server) override {
    bleConnected = false;
    disconnectedAt = millis();
    Serial.println("[BLE] 게이트웨이 연결 끊김");
  }
};

class ControlCommandCallbacks : public BLECharacteristicCallbacks {
 public:
  void onWrite(BLECharacteristic* characteristic) override {
    const String value = characteristic->getValue();
    if (value.length() > 0) {
      handleControlCommand(value);
    }
  }
};

void initializeBle() {
  BLEDevice::init(DudeojiControl::BLE_DEVICE_NAME);
  BLEDevice::setMTU(247);

  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new ControlServerCallbacks());

  BLEService* service =
      bleServer->createService(DudeojiControl::SERVICE_UUID);

  stateCharacteristic = service->createCharacteristic(
      DudeojiControl::SENSOR_CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_READ |
          BLECharacteristic::PROPERTY_NOTIFY);
  stateCharacteristic->addDescriptor(new BLE2902());

  BLECharacteristic* controlCharacteristic =
      service->createCharacteristic(
          DudeojiControl::CONTROL_CHARACTERISTIC_UUID,
          BLECharacteristic::PROPERTY_WRITE);
  controlCharacteristic->setCallbacks(
      new ControlCommandCallbacks());

  resultCharacteristic = service->createCharacteristic(
      DudeojiControl::RESULT_CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_NOTIFY);
  resultCharacteristic->addDescriptor(new BLE2902());

  service->start();

  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(DudeojiControl::SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->setMinPreferred(0x06);
  advertising->setMinPreferred(0x12);
  advertising->start();

  Serial.print("[BLE] Advertising 시작: ");
  Serial.println(DudeojiControl::BLE_DEVICE_NAME);
}

void handleManualButton() {
  const bool reading =
      digitalRead(DudeojiControl::MANUAL_BUTTON_PIN);

  if (reading != lastButtonReading) {
    lastButtonChangeAt = millis();
    lastButtonReading = reading;
  }

  if (
      millis() - lastButtonChangeAt >=
          DudeojiControl::BUTTON_DEBOUNCE_MS &&
      reading != stableButtonState) {
    stableButtonState = reading;

    if (stableButtonState == LOW) {
      setFan(!fanOn);
      forcePublish = true;
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
  Serial.println("두더지 ESP-CONTROL BLE 펌웨어 시작");
  Serial.println("================================");

  // 부팅 중 릴레이가 순간적으로 켜지지 않도록 OFF 값을 먼저 기록합니다.
  digitalWrite(DudeojiControl::RELAY_PIN, relayOffLevel());
  pinMode(DudeojiControl::RELAY_PIN, OUTPUT);
  setFan(false);

  pinMode(DudeojiControl::REED_PIN, INPUT_PULLUP);
  pinMode(
      DudeojiControl::MANUAL_BUTTON_PIN,
      INPUT_PULLUP);

  // 서보와 팬의 실제 부하 전류는 외부 전원에서 공급해야 합니다.
  windowServo.setPeriodHertz(50);
  windowServo.attach(
      DudeojiControl::SERVO_PIN,
      500,
      2400);
  setWindowPosition(false);

  // 실패해도 아래 BLE/서보/릴레이 초기화와 loop는 계속 진행합니다.
  inaAvailable = initializeIna219();
  initializeBle();
}

void loop() {
  handleManualButton();

  if (
      bleConnected &&
      (forcePublish ||
       millis() - lastPublishAt >=
           DudeojiControl::PUBLISH_INTERVAL_MS)) {
    publishControlState();
  }

  if (
      !bleConnected &&
      wasBleConnected &&
      millis() - disconnectedAt >=
          DudeojiControl::BLE_READVERTISE_DELAY_MS) {
    bleServer->startAdvertising();
    wasBleConnected = false;
    Serial.println("[BLE] Advertising 재시작");
  }

  if (bleConnected && !wasBleConnected) {
    wasBleConnected = true;
  }

  delay(5);
}
