#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

#include "secrets.h"

WebSocketsClient webSocket;

// 서버 연결 후 인증 메시지를 전송한다.
void sendAuthMessage() {
  JsonDocument doc;

  doc["type"] = "auth";
  doc["token"] = AUTH_TOKEN;

  String message;
  serializeJson(doc, message);

  webSocket.sendTXT(message);

  Serial.println("[WS] 인증 메시지 전송");
}

// 서버에서 받은 기기 제어 명령을 처리한다.
void handleDeviceCommand(JsonDocument& doc) {
  const char* action = doc["action"] | "";

  Serial.print("[COMMAND] 수신: ");
  Serial.println(action);

  if (strcmp(action, "OPEN_WINDOW") == 0) {
    // 나중에 SG90 서보 창문 열기 코드가 들어갈 자리
    Serial.println("[ACTION] 창문 열기");

  } else if (strcmp(action, "CLOSE_WINDOW") == 0) {
    // 나중에 SG90 서보 창문 닫기 코드가 들어갈 자리
    Serial.println("[ACTION] 창문 닫기");

  } else if (strcmp(action, "TURN_ON_AIRCON") == 0) {
    // 실제 시연에서는 에어컨 대신 팬 릴레이를 켠다.
    Serial.println("[ACTION] 팬 작동");

  } else if (strcmp(action, "TURN_OFF_AIRCON") == 0) {
    // 실제 시연에서는 에어컨 대신 팬 릴레이를 끈다.
    Serial.println("[ACTION] 팬 정지");

  } else {
    Serial.println("[COMMAND] 알 수 없는 명령");
  }
}

// WebSocket에서 받은 JSON 문자열을 해석한다.
void handleTextMessage(uint8_t* payload, size_t length) {
  JsonDocument doc;

  DeserializationError error = deserializeJson(
    doc,
    reinterpret_cast<const char*>(payload),
    length
  );

  if (error) {
    Serial.print("[JSON] 해석 실패: ");
    Serial.println(error.c_str());
    return;
  }

  const char* messageType = doc["type"] | "";

  Serial.print("[WS] 메시지 유형: ");
  Serial.println(messageType);

  if (strcmp(messageType, "device_command") == 0) {
    handleDeviceCommand(doc);
    return;
  }

  if (strcmp(messageType, "auth_ok") == 0) {
    Serial.println("[WS] 인증 성공");
    return;
  }

  if (strcmp(messageType, "pong") == 0) {
    Serial.println("[WS] pong 수신");
    return;
  }

  Serial.println("[WS] 처리하지 않는 메시지");
}

// WebSocket 상태 변화와 수신 메시지를 처리한다.
void webSocketEvent(
  WStype_t type,
  uint8_t* payload,
  size_t length
) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("[WS] 연결 끊김");
      break;

    case WStype_CONNECTED:
      Serial.println("[WS] 서버 연결 성공");
      sendAuthMessage();
      break;

    case WStype_TEXT:
      handleTextMessage(payload, length);
      break;

    case WStype_ERROR:
      Serial.println("[WS] 통신 오류");
      break;

    case WStype_PING:
      Serial.println("[WS] ping 수신");
      break;

    case WStype_PONG:
      Serial.println("[WS] pong 수신");
      break;

    default:
      break;
  }
}

// Wi-Fi에 연결한다.
void connectWiFi() {
  Serial.print("[WIFI] 연결 시작: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("[WIFI] 연결 성공");

  Serial.print("[WIFI] XIAO IP: ");
  Serial.println(WiFi.localIP());
}

// WebSocket 연결을 시작한다.
void connectWebSocket() {
  String path =
    String("/ws/sensors?place_id=") +
    String(PLACE_ID);

  Serial.print("[WS] 연결 주소: ws://");
  Serial.print(WS_HOST);
  Serial.print(":");
  Serial.print(WS_PORT);
  Serial.println(path);

  webSocket.begin(
    WS_HOST,
    WS_PORT,
    path.c_str()
  );

  webSocket.onEvent(webSocketEvent);

  // 연결이 끊기면 5초 후 다시 연결한다.
  webSocket.setReconnectInterval(5000);

  // 연결 유지 확인
  webSocket.enableHeartbeat(
    15000,  // 15초마다 ping
    3000,   // pong을 3초 기다림
    2       // 2회 실패 시 재연결
  );
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("==============================");
  Serial.println("두더지 XIAO 펌웨어 시작");
  Serial.println("==============================");

  connectWiFi();
  connectWebSocket();
}

void loop() {
  // 반드시 반복 호출해야 WebSocket 수신이 처리된다.
  webSocket.loop();
}