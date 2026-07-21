import { useState, useEffect } from 'react';

export default function RecommendationPopup({ recommendation, currentToken, setIsPopupActive, placeId }) {
  const [isOpen, setIsOpen] = useState(false);
  const [rejectedId] = useState(null); // 중복 팝업 방지용 (필요시 활성화)

  // 💡 팝업의 열림/닫힘 상태(isOpen)가 바뀔 때마다 App.jsx의 타이머 제어 함수를 호출합니다.
  useEffect(() => {
    if (setIsPopupActive) {
      setIsPopupActive(isOpen);
    }
  }, [isOpen, setIsPopupActive]);

  // 백엔드에서 새로운 추천 데이터가 들어왔을 때 열림 여부를 판단합니다.
  useEffect(() => {
    if (recommendation && recommendation.is_auto_triggered) {
      const recommendationId = recommendation.id || recommendation.measured_at;
      if (rejectedId !== recommendationId) {
        setIsOpen(true);
      }
    }
  }, [recommendation, rejectedId]);

  // '예'를 눌러 기기를 제어하고 팝업을 닫는 로직
  const handleConfirm = async () => {
    setIsOpen(false); // 여기서 isOpen이 false가 되며 App.jsx의 타이머가 재개됩니다.
    try {
      const response = await fetch('http://127.0.0.1:8000/api/devices/control', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`
        },
        body: JSON.stringify({
          place_id: placeId,
          action: recommendation.action
        })
      });

      if (response.ok) {
        alert(`${recommendation.title} 명령을 전송했습니다.`);
      } else {
        alert("기기 제어 요청에 실패했습니다.");
      }
    } catch (error) {
      console.error("오류:", error);
    }
  };

  // '아니오'를 눌러 추천을 거절하고 팝업을 닫는 로직
  const handleCancel = () => {
    setIsOpen(false); // 여기서 isOpen이 false가 되며 App.jsx의 타이머가 재개됩니다.
  };

  if (!isOpen || !recommendation) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg shadow-xl max-w-sm w-full mx-4">
        <h2 className="text-xl font-bold mb-2">{recommendation.title}</h2>
        <p className="mb-4 text-gray-600">{recommendation.summary}</p>
        <div className="mb-6 p-3 bg-gray-100 text-sm rounded">
          <strong>추천 이유:</strong> {recommendation.reason}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={handleCancel} className="px-4 py-2 bg-gray-200 rounded">아니오</button>
          <button onClick={handleConfirm} className="px-4 py-2 bg-blue-600 text-white rounded">예</button>
        </div>
      </div>
    </div>
  );
}