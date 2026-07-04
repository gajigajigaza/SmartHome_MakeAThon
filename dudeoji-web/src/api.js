// Render에 배포한 FastAPI 백엔드 주소를 사용한다.
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  "https://dudeoji-makerthon.onrender.com";
  
/**
 * 백엔드 API에 요청을 보내는 공통 함수
 *
 * @param {string} path - 요청할 API 경로
 * @param {RequestInit} options - fetch 요청 설정
 * @returns {Promise<any>} 백엔드에서 받은 JSON 데이터
 */
async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    // JSON 데이터를 주고받는다고 백엔드에 알려준다.
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },

    // GET, POST, body 등의 추가 설정을 적용한다.
    ...options,
  });

  // 백엔드가 200번대가 아닌 오류 응답을 보냈을 때 처리한다.
  if (!response.ok) {
    let errorMessage = `백엔드 요청 실패: ${response.status}`;

    try {
      const errorData = await response.json();

      // FastAPI가 보내는 detail 오류 메시지가 있다면 사용한다.
      errorMessage = errorData.detail ?? errorMessage;
    } catch {
      // 오류 응답이 JSON 형식이 아니면 기본 오류 메시지를 사용한다.
    }

    throw new Error(errorMessage);
  }

  // 백엔드가 보낸 JSON 결과를 반환한다.
  return response.json();
}

/**
 * 새로운 센서 측정값을 백엔드에 저장하고
 * AI 추천 결과를 받아온다.
 *
 * 요청 주소: POST /api/readings
 *
 * @param {object} sensorData - 온도, 습도, 재실 여부 등의 센서 데이터
 */
export function createReading(sensorData) {
  return request("/api/readings", {
    method: "POST",

    // 자바스크립트 객체를 JSON 문자열로 변환해서 전송한다.
    body: JSON.stringify(sensorData),
  });
}

/**
 * 최근 센서 측정 기록을 가져온다.
 *
 * 요청 주소: GET /api/readings/history
 *
 * @param {number} limit - 가져올 기록의 최대 개수
 */
export function fetchReadingHistory(limit = 8) {
  return request(`/api/readings/history?limit=${limit}`);
}