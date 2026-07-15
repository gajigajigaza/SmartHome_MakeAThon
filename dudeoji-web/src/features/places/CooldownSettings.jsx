/* eslint-disable react/prop-types */
import React, { useState } from 'react';

export default function CooldownSettings({ placeId = 1, currentToken }) {
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
    try {
      const response = await fetch(`http://127.0.0.1:8000/api/places/${placeId}/cooldown`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`
        },
        body: JSON.stringify({ target_cooldown_minutes: Number(minutes) })
      });

      if (response.ok) {
        alert("성공적으로 저장되었습니다.");
      } else {
        alert("저장에 실패했습니다.");
      }
    } catch (error) {
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