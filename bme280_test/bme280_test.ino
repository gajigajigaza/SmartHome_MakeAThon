#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>

Adafruit_BME280 bme;
bool sensorFound = false;

void setup() {
  Serial.begin(115200);
  delay(2000);

  // XIAO ESP32S3: SDA=D4(GPIO5), SCL=D5(GPIO6)
  Wire.begin(D4, D5);

  Serial.println();
  Serial.println("=== XIAO ESP32S3 BME280 테스트 ===");

  Serial.println("I2C 장치를 검색합니다...");

  for (uint8_t address = 1; address < 127; address++) {
    Wire.beginTransmission(address);

    if (Wire.endTransmission() == 0) {
      Serial.print("I2C 장치 발견: 0x");

      if (address < 16) {
        Serial.print("0");
      }

      Serial.println(address, HEX);
    }
  }

  // BME280의 일반적인 주소는 0x76 또는 0x77
  if (bme.begin(0x76, &Wire)) {
    Serial.println("BME280 연결 성공: 주소 0x76");
    sensorFound = true;
  } else if (bme.begin(0x77, &Wire)) {
    Serial.println("BME280 연결 성공: 주소 0x77");
    sensorFound = true;
  } else {
    Serial.println("BME280을 찾지 못했습니다.");
    Serial.println("배선과 I2C 검색 결과를 확인하세요.");
  }
}

void loop() {
  if (!sensorFound) {
    delay(3000);
    return;
  }

  Serial.println("-------------------------");

  Serial.print("온도: ");
  Serial.print(bme.readTemperature(), 1);
  Serial.println(" °C");

  Serial.print("습도: ");
  Serial.print(bme.readHumidity(), 1);
  Serial.println(" %");

  Serial.print("기압: ");
  Serial.print(bme.readPressure() / 100.0F, 1);
  Serial.println(" hPa");

  delay(2000);
}
