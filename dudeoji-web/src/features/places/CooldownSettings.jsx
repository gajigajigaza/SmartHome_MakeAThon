import { useState } from 'react';

import { request } from '../../api';

// jh 수정함 - placeId 하드코딩 기본값(1)과 http://127.0.0.1:8000 직접 fetch를
// 제거. 호출하는 쪽이 선택된 장소의 placeId를 반드시 넘기도록 하고,
// 공용 request() 헬퍼(api.js)를 써서 배포 환경 API 주소를 그대로 따라가게 했다.
export default function CooldownSettings({ placeId }) {
  const [roomSize, setRoomSize] = useState("거실/투룸");
  const [minutes, setMinutes] = useState(30);

  const handleRoomSizeChange = (e) => {
    const size = e.target.value;
    setRoomSize(size);
    if (size === "원룸/소형") setMinutes(20);
    else if (size === "거실/투룸") setMinutes(30);
    else if (size === "대형 평수") setMinutes(45);
  };

  const handleSave = async () => {
    if (!placeId) {
      alert("장소가 선택되지 않았습니다.");
      return;
    }

    try {
      await request(`/api/places/${placeId}/cooldown`, {
        method: 'PATCH',
        auth: true,
        body: JSON.stringify({ target_cooldown_minutes: Number(minutes) }),
      });
      alert("성공적으로 저장되었습니다.");
    } catch (error) {
      alert("저장에 실패했습니다.");
      console.error("오류:", error);
    }
  };

  return (
    <div className="p-5 border rounded bg-white max-w-md">
      <h3 className="text-lg font-bold mb-4">⏱️ 에어컨 자동 제어 설정</h3>
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">방 크기 선택</label>
        <select value={roomSize} onChange={handleRoomSizeChange} className="w-full p-2 border rounded">
          <option value="원룸/소형">원룸/소형 (20분)</option>
          <option value="거실/투룸">거실/투룸 (30분)</option>
          <option value="대형 평수">대형 평수 (45분)</option>
        </select>
      </div>
      <div className="mb-6">
        <label className="block text-sm font-medium mb-1">가동 시간 직접 설정(분)</label>
        <input type="number" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="w-full p-2 border rounded" min="1" />
      </div>
      <button onClick={handleSave} className="w-full bg-blue-500 text-white p-2 rounded">저장</button>
    </div>
  );
}