// Edge1 사람 감지 - 사전학습된 TensorFlow Lite Micro 모델 래퍼
//
// 모델: Google TensorFlow 팀이 Visual Wake Words 데이터셋으로 학습해 공개한
// int8 양자화 person_detect 모델 (96x96 그레이스케일 입력, notperson/person
// 2클래스 출력, 약 250KB). 별도 학습 없이 그대로 갖다 쓰는 사전학습 모델이다.
// 출처: https://github.com/tensorflow/tflite-micro-arduino-examples
//       (examples/person_detection, Apache License 2.0)
//
// 이 프로젝트에서는 원본 예제의 setup()/loop() 이름 충돌을 피하고
// Edge1_ESP.ino의 카메라(esp_camera)를 그대로 재사용하도록 다시 감쌌다.

#ifndef PERSON_DETECTOR_H_
#define PERSON_DETECTOR_H_

// 모델/인터프리터 초기화. 성공하면 true.
bool personDetectorSetup();

// 카메라에서 96x96 그레이스케일 프레임을 캡처해 추론하고,
// 프레임 버퍼는 픽셀을 텐서로 옮기는 즉시 해제한다.
// 반환값: 사람이 감지되면 true.
bool personDetectorRunInference();

#endif  // PERSON_DETECTOR_H_
