// Render에 배포된 FastAPI 백엔드의 기본 주소이다.
// 주소 마지막에는 /를 붙이지 않는다.
const API_BASE_URL = "https://dudeoji-makerthon.onrender.com";


// 서버 응답을 확인하고 JSON 데이터를 반환하는 공통 함수이다.
async function request(endpoint, options = {}) {
  // 기본 주소와 API 경로를 합쳐 요청한다.
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    // JSON 데이터를 보내기 위한 기본 헤더이다.
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },

    // GET, POST, body 등의 추가 설정을 적용한다.
    ...options,
  });

  // 서버가 200번대 응답을 보내지 않았다면 오류 내용을 확인한다.
  if (!response.ok) {
    let errorMessage = `API 요청 실패: ${response.status}`;

    try {
      const errorData = await response.json();

      // FastAPI가 반환한 detail이 있으면 오류 메시지로 사용한다.
      if (errorData.detail) {
        errorMessage = errorData.detail;
      }
    } catch {
      // JSON 오류 응답이 아니면 기본 메시지를 사용한다.
    }

    throw new Error(errorMessage);
  }

  // 정상 응답의 JSON 데이터를 반환한다.
  return response.json();
}


// 새로운 실내외 온습도 데이터를 DB에 저장한다.
export async function createReading(sensorData) {
  return request("/api/readings", {
    method: "POST",

    // JavaScript 객체를 JSON 문자열로 바꿔 전송한다.
    body: JSON.stringify(sensorData),
  });
}


// 가장 최근에 저장된 센서 데이터를 조회한다.
export async function getLatestReading() {
  return request("/api/readings/latest");
}


// 최근 센서 데이터 여러 개를 조회한다.
export async function getReadingHistory(limit = 8) {
  return request(`/api/readings/history?limit=${limit}`);
}


// 기존 App.jsx가 사용하는 함수 이름과 연결한다.
export const fetchReadingHistory = getReadingHistory;

// 가장 최근 추천 결과만 조회한다.
export async function getRecommendation() {
  return request("/api/recommendation");
}


// 다른 파일에서도 백엔드 주소가 필요할 때 사용할 수 있도록 내보낸다.
export { API_BASE_URL };