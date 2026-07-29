#include <WiFi.h>

const char *AP_SSID = "dududo";
const char *AP_PASSWORD = "12341234";

constexpr uint8_t TOUCH_PIN = D1;  // XIAO ESP32S3 D1 = GPIO2
constexpr uint8_t LED_PIN = LED_BUILTIN;

WiFiServer server(80);
bool ledOn = false;

const char INDEX_HTML[] PROGMEM = R"HTML(
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>XIAO ESP32S3</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:440px;margin:40px auto;padding:20px;
         text-align:center;background:#111827;color:#f9fafb}
    .card{background:#1f2937;border-radius:18px;padding:28px;box-shadow:0 10px 30px #0005}
    #touch{font-size:3rem;font-weight:700;color:#60a5fa;margin:12px}
    button{border:0;border-radius:12px;padding:14px 25px;margin:8px;font-size:1.05rem;
           font-weight:700;cursor:pointer}
    .on{background:#22c55e}.off{background:#ef4444;color:white}
    #state{font-weight:700}
  </style>
</head>
<body>
  <div class="card">
    <h1>Touch Sensor</h1>
    <div id="touch">--</div>
    <p>내장 LED: <span id="state">OFF</span></p>
    <button class="on" onclick="setLed(1)">LED ON</button>
    <button class="off" onclick="setLed(0)">LED OFF</button>
  </div>
  <script>
    async function updateTouch() {
      try {
        const r = await fetch('/touch');
        const d = await r.json();
        document.getElementById('touch').textContent = d.value;
        document.getElementById('state').textContent = d.led ? 'ON' : 'OFF';
      } catch (_) {}
    }
    async function setLed(value) {
      await fetch('/led?state=' + value);
      updateTouch();
    }
    updateTouch();
    setInterval(updateTouch, 250);
  </script>
</body>
</html>
)HTML";

void applyLed() {
  digitalWrite(LED_PIN, ledOn ? LOW : HIGH);
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  applyLed();

  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASSWORD);

  server.begin();
  Serial.println();
  Serial.print("AP IP: ");
  Serial.println(WiFi.softAPIP());
}

void loop() {
  WiFiClient client = server.accept();
  if (!client) {
    delay(2);
    return;
  }

  client.setTimeout(1000);
  String request = client.readStringUntil('\r');
  while (client.connected() && client.available()) client.read();

  String contentType = "text/plain";
  String body;
  int status = 200;

  if (request.startsWith("GET /touch ")) {
    contentType = "application/json";
    body = "{\"value\":" + String(touchRead(TOUCH_PIN)) +
           ",\"led\":" + String(ledOn ? "true" : "false") + "}";
  } else if (request.startsWith("GET /led?state=1 ")) {
    ledOn = true;
    applyLed();
    body = "ON";
  } else if (request.startsWith("GET /led?state=0 ")) {
    ledOn = false;
    applyLed();
    body = "OFF";
  } else if (request.startsWith("GET / ")) {
    contentType = "text/html; charset=utf-8";
    body = FPSTR(INDEX_HTML);
  } else {
    status = 404;
    body = "Not found";
  }

  client.printf("HTTP/1.1 %d %s\r\n", status, status == 200 ? "OK" : "Not Found");
  client.println("Connection: close");
  client.print("Content-Type: ");
  client.println(contentType);
  client.print("Content-Length: ");
  client.println(body.length());
  client.println();
  client.print(body);
  client.stop();
}
