#include "person_detector.h"

#include <Arduino.h>
#include "esp_camera.h"
#include "esp_heap_caps.h"

#include "person_detect_model_data.h"
#include "model_settings.h"
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/micro/micro_mutable_op_resolver.h"
#include "tensorflow/lite/micro/micro_utils.h"
#include "tensorflow/lite/micro/system_setup.h"
#include "tensorflow/lite/schema/schema_generated.h"

namespace {
const tflite::Model *model = nullptr;
tflite::MicroInterpreter *interpreter = nullptr;
TfLiteTensor *input = nullptr;

// 모델이 요구하는 작업(스캐폴딩) 메모리. 내장 SRAM을 아끼기 위해
// PSRAM(XIAO ESP32S3 Sense는 8MB 보유)에 할당한다.
constexpr int kTensorArenaSize = 136 * 1024;
uint8_t *tensorArena = nullptr;
}  // namespace

bool personDetectorSetup() {
  tflite::InitializeTarget();

  tensorArena = (uint8_t *)heap_caps_aligned_alloc(16, kTensorArenaSize, MALLOC_CAP_SPIRAM);
  if (tensorArena == nullptr) {
    Serial.println("[TFLite] tensor arena PSRAM 할당 실패");
    return false;
  }

  model = tflite::GetModel(g_person_detect_model_data);
  if (model->version() != TFLITE_SCHEMA_VERSION) {
    Serial.printf("[TFLite] 모델 스키마 버전 불일치 (model=%d, supported=%d)\n",
                  model->version(), TFLITE_SCHEMA_VERSION);
    return false;
  }

  // 이 모델 그래프가 실제로 쓰는 연산만 등록해 코드 크기를 줄인다.
  static tflite::MicroMutableOpResolver<5> resolver;
  resolver.AddAveragePool2D();
  resolver.AddConv2D();
  resolver.AddDepthwiseConv2D();
  resolver.AddReshape();
  resolver.AddSoftmax();

  static tflite::MicroInterpreter staticInterpreter(
      model, resolver, tensorArena, kTensorArenaSize);
  interpreter = &staticInterpreter;

  if (interpreter->AllocateTensors() != kTfLiteOk) {
    Serial.println("[TFLite] AllocateTensors 실패");
    return false;
  }

  input = interpreter->input(0);
  if (input->dims->size != 4 || input->dims->data[0] != 1 ||
      input->dims->data[1] != kNumRows || input->dims->data[2] != kNumCols ||
      input->dims->data[3] != kNumChannels || input->type != kTfLiteInt8) {
    Serial.println("[TFLite] 입력 텐서 형식이 예상과 다름");
    return false;
  }

  Serial.println("[TFLite] 사람 감지 모델 초기화 완료 (person_detect, 96x96 grayscale)");
  return true;
}

bool personDetectorRunInference() {
  if (interpreter == nullptr) return false;

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[CAM] 프레임 캡처 실패");
    return false;
  }
  if (fb->len < (size_t)kMaxImageSize) {
    Serial.printf("[CAM] 프레임 크기 불일치 (len=%u, 기대값=%d) - 카메라 해상도 설정 확인 필요\n",
                  (unsigned)fb->len, kMaxImageSize);
    esp_camera_fb_return(fb);
    return false;
  }

  // 픽셀을 모델 입력(int8 양자화)으로 즉시 옮긴다. 이미지 자체는
  // 어디에도 저장/전송하지 않고, 필요한 값만 텐서로 복사한다.
  for (int i = 0; i < kMaxImageSize; i++) {
    input->data.int8[i] = tflite::FloatToQuantizedType<int8_t>(
        fb->buf[i] / 255.0f, input->params.scale, input->params.zero_point);
  }
  esp_camera_fb_return(fb);  // 필요한 값 복사 완료 -> 프레임 버퍼 즉시 해제

  if (interpreter->Invoke() != kTfLiteOk) {
    Serial.println("[TFLite] Invoke 실패");
    return false;
  }

  TfLiteTensor *output = interpreter->output(0);
  int8_t personScore = output->data.int8[kPersonIndex];
  int8_t noPersonScore = output->data.int8[kNotAPersonIndex];

  return personScore > noPersonScore;
}
