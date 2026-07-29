#include <Arduino.h>
#include <Wire.h>

#include <esp_camera.h>

// esp32-camera와 Adafruit Unified Sensor가 서로 다른 구조체에 같은
// sensor_t typedef 이름을 사용합니다. 이 번역 단위에서 Adafruit 쪽
// typedef만 지역적으로 이름을 바꿔 두 라이브러리를 함께 사용합니다.
#define sensor_t adafruit_sensor_t
#include <Adafruit_BME280.h>
#undef sensor_t

#include <ArduinoJson.h>
#include <BLE2902.h>
#include <BLEAdvertising.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>

#include "person_detector.h"

// ---------------------------------------------------------------------------
// ESP-SENSE: XIAO ESP32S3 Sense 카메라 + BME280
//
// 데이터 경로:
//   카메라 준비 상태·BME280·사람 감지 -> BLE Notification -> Raspberry Pi 게이트웨이
//
// 카메라 프레임은 BLE나 microSD로 전송·저장하지 않습니다. person_detected는
// Google TensorFlow 팀이 공개한 사전학습 person_detect 모델(Visual Wake
// Words 데이터셋, int8, 96x96 그레이스케일)로 온디바이스 추론한 값입니다.
// 카메라나 모델 초기화가 실패한 경우에만 계약값 그대로 null을 보냅니다.
// 실제 추론 코드는 person_detector.h/.cpp 참고.
// ---------------------------------------------------------------------------

namespace DudeojiSense {

constexpr char BLE_DEVICE_NAME[] = "DUDEOJI-SENSE";
constexpr char DEVICE_ID[] = "sense-01";

// dudeoji-gateway/protocol.py와 같은 UUID를 사용합니다.
constexpr char SERVICE_UUID[] =
    "7d2ea28a-f7bd-485a-bd9d-92ad6ecfe93e";
constexpr char SENSOR_CHARACTERISTIC_UUID[] =
    "7d2ea28b-f7bd-485a-bd9d-92ad6ecfe93e";

// 외부 BME280: XIAO D4(GPIO5) / D5(GPIO6)
constexpr uint8_t BME_SDA_PIN = D4;
constexpr uint8_t BME_SCL_PIN = D5;

// XIAO ESP32S3 Sense 내장 OV2640 카메라 핀.
// esp32:esp32 3.3.11 CameraWebServer 예제의 XIAO_ESP32S3 정의와 같습니다.
constexpr int CAMERA_PWDN_PIN = -1;
constexpr int CAMERA_RESET_PIN = -1;
constexpr int CAMERA_XCLK_PIN = 10;
constexpr int CAMERA_SIOD_PIN = 40;
constexpr int CAMERA_SIOC_PIN = 39;
constexpr int CAMERA_Y9_PIN = 48;
constexpr int CAMERA_Y8_PIN = 11;
constexpr int CAMERA_Y7_PIN = 12;
constexpr int CAMERA_Y6_PIN = 14;
constexpr int CAMERA_Y5_PIN = 16;
constexpr int CAMERA_Y4_PIN = 18;
constexpr int CAMERA_Y3_PIN = 17;
constexpr int CAMERA_Y2_PIN = 15;
constexpr int CAMERA_VSYNC_PIN = 38;
constexpr int CAMERA_HREF_PIN = 47;
constexpr int CAMERA_PCLK_PIN = 13;

constexpr unsigned long PUBLISH_INTERVAL_MS = 5000;
constexpr unsigned long BLE_READVERTISE_DELAY_MS = 500;

}  // namespace DudeojiSense

Adafruit_BME280 bme;

BLEServer* bleServer = nullptr;
BLECharacteristic* environmentCharacteristic = nullptr;

volatile bool bleConnected = false;
bool wasBleConnected = false;
bool bmeAvailable = false;
bool cameraReady = false;
bool tfliteReady = false;
volatile bool forcePublish = true;

unsigned long lastPublishAt = 0;
unsigned long disconnectedAt = 0;

bool initializeBme280() {
  Wire.begin(
      DudeojiSense::BME_SDA_PIN,
      DudeojiSense::BME_SCL_PIN);

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

bool initializeCamera() {
  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = DudeojiSense::CAMERA_Y2_PIN;
  config.pin_d1 = DudeojiSense::CAMERA_Y3_PIN;
  config.pin_d2 = DudeojiSense::CAMERA_Y4_PIN;
  config.pin_d3 = DudeojiSense::CAMERA_Y5_PIN;
  config.pin_d4 = DudeojiSense::CAMERA_Y6_PIN;
  config.pin_d5 = DudeojiSense::CAMERA_Y7_PIN;
  config.pin_d6 = DudeojiSense::CAMERA_Y8_PIN;
  config.pin_d7 = DudeojiSense::CAMERA_Y9_PIN;
  config.pin_xclk = DudeojiSense::CAMERA_XCLK_PIN;
  config.pin_pclk = DudeojiSense::CAMERA_PCLK_PIN;
  config.pin_vsync = DudeojiSense::CAMERA_VSYNC_PIN;
  config.pin_href = DudeojiSense::CAMERA_HREF_PIN;
  config.pin_sccb_sda = DudeojiSense::CAMERA_SIOD_PIN;
  config.pin_sccb_scl = DudeojiSense::CAMERA_SIOC_PIN;
  config.pin_pwdn = DudeojiSense::CAMERA_PWDN_PIN;
  config.pin_reset = DudeojiSense::CAMERA_RESET_PIN;
  config.xclk_freq_hz = 20000000;
  // 사람 감지 모델 입력(96x96 그레이스케일)에 맞춘다. JPEG로는 사람 감지를
  // 못 붙이고, person_detect 모델도 이 해상도/포맷을 그대로 요구하기 때문에
  // 카메라를 처음부터 이 설정으로 초기화한다.
  config.pixel_format = PIXFORMAT_GRAYSCALE;
  config.frame_size = FRAMESIZE_96X96;
  config.fb_count = 1;
  config.grab_mode = CAMERA_GRAB_LATEST;
  config.fb_location =
      psramFound() ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;

  const esp_err_t error = esp_camera_init(&config);
  if (error != ESP_OK) {
    Serial.printf("[CAMERA] 초기화 실패: 0x%x\n", error);
    return false;
  }

  // 초기화 성공만으로 끝내지 않고 시험 프레임을 한 번 받아 센서와
  // 프레임 버퍼가 실제로 동작하는지 확인합니다. 프레임은 즉시 반환하며
  // BLE나 microSD로 전송·저장하지 않습니다.
  camera_fb_t* frame = esp_camera_fb_get();
  if (frame == nullptr) {
    Serial.println("[CAMERA] 시험 프레임 획득 실패");
    esp_camera_deinit();
    return false;
  }

  Serial.printf(
      "[CAMERA] 준비 완료: %ux%u, %u bytes\n",
      frame->width,
      frame->height,
      frame->len);
  esp_camera_fb_return(frame);
  return true;
}

void publishEnvironment() {
  if (!bleConnected || environmentCharacteristic == nullptr) {
    return;
  }

  JsonDocument doc;
  doc["type"] = "environment";
  doc["device_id"] = DudeojiSense::DEVICE_ID;

  bool readingValid = bmeAvailable;
  float temperature = NAN;
  float humidity = NAN;

  if (bmeAvailable) {
    temperature = bme.readTemperature();
    humidity = bme.readHumidity();
    readingValid = isfinite(temperature) && isfinite(humidity);
  }

  doc["bme_ok"] = readingValid;
  if (readingValid) {
    doc["temperature"] = roundf(temperature * 10.0f) / 10.0f;
    doc["humidity"] = roundf(humidity * 10.0f) / 10.0f;
  } else {
    doc["temperature"] = nullptr;
    doc["humidity"] = nullptr;
  }

  doc["camera_ready"] = cameraReady;
  // 카메라/모델이 준비되지 않았으면 임의의 false로 추정하지 않고 계약대로
  // null을 보낸다. 준비됐으면 온디바이스 추론 결과를 그대로 보낸다.
  if (cameraReady && tfliteReady) {
    doc["person_detected"] = personDetectorRunInference();
  } else {
    doc["person_detected"] = nullptr;
  }

  String payload;
  serializeJson(doc, payload);
  environmentCharacteristic->setValue(payload.c_str());
  environmentCharacteristic->notify();

  Serial.print("[BLE TX] ");
  Serial.println(payload);

  lastPublishAt = millis();
  forcePublish = false;
}

class SenseServerCallbacks : public BLEServerCallbacks {
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

void initializeBle() {
  BLEDevice::init(DudeojiSense::BLE_DEVICE_NAME);
  BLEDevice::setMTU(247);

  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new SenseServerCallbacks());

  BLEService* service =
      bleServer->createService(DudeojiSense::SERVICE_UUID);

  environmentCharacteristic = service->createCharacteristic(
      DudeojiSense::SENSOR_CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_READ |
          BLECharacteristic::PROPERTY_NOTIFY);
  environmentCharacteristic->addDescriptor(new BLE2902());

  service->start();

  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(DudeojiSense::SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->setMinPreferred(0x06);
  advertising->setMinPreferred(0x12);
  advertising->start();

  Serial.print("[BLE] Advertising 시작: ");
  Serial.println(DudeojiSense::BLE_DEVICE_NAME);
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("================================");
  Serial.println("두더지 ESP-SENSE BLE 펌웨어 시작");
  Serial.println("================================");

  cameraReady = initializeCamera();
  if (cameraReady) {
    tfliteReady = personDetectorSetup();
    if (!tfliteReady) {
      Serial.println(
          "[TFLite] 모델 초기화 실패, person_detected는 계속 null로 전송");
    }
  }
  bmeAvailable = initializeBme280();
  initializeBle();
}

void loop() {
  if (
      bleConnected &&
      (forcePublish ||
       millis() - lastPublishAt >=
           DudeojiSense::PUBLISH_INTERVAL_MS)) {
    publishEnvironment();
  }

  if (
      !bleConnected &&
      wasBleConnected &&
      millis() - disconnectedAt >=
          DudeojiSense::BLE_READVERTISE_DELAY_MS) {
    bleServer->startAdvertising();
    wasBleConnected = false;
    Serial.println("[BLE] Advertising 재시작");
  }

  if (bleConnected && !wasBleConnected) {
    wasBleConnected = true;
  }

  delay(5);
}
