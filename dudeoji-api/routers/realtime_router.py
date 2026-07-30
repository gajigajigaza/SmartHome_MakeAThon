"""센서 송신용·웹 구독용 WebSocket 엔드포인트.

센서 게이트웨이(노트북 또는 Raspberry Pi):
    /ws/sensors?place_id=장소ID

React 웹:
    /ws/readings?place_id=장소ID

두 연결 모두 접속 직후 첫 JSON 메시지로 로그인 토큰을 전송합니다.
    {"type": "auth", "token": "..."}
"""

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from device_auth import authenticate_device_or_user
from device_connection_hub import DeviceConnectionError, device_hub
from device_state_contract import (
    DeviceStateContractError,
    validate_device_state_data,
)
from sensor_realtime_hub import reading_hub
from routers.readings_router import get_place_for_user, save_reading_for_user

router = APIRouter(tags=["realtime"])
AUTH_TIMEOUT_SECONDS = 10


class _LatestReadingSlot:
    """"가장 최신 값 하나만" 유지하는 깊이 1 큐.

    jh 추가 - 이슈 #38. 펌웨어는 서버 상태와 무관하게 고정 타이머로
    (PUBLISH_INTERVAL_MS) 값을 밀어 넣고, 게이트웨이도 서버 ack를 기다리지
    않는다. 그래서 저장 1건이 발행 주기보다 오래 걸리기 시작하면 밀린 일이
    그대로 쌓인다 — 예전에는 receive 루프에서 저장을 그대로 await했기 때문에
    그 밀림이 소켓 수신 버퍼에 무한정 고이는 구조였다.

    센서값은 "지금 상태"를 알려주는 값이라 3초 전 값을 굳이 저장할 이유가
    없다. 처리 중에 새 값이 오면 대기 중인 값을 버리고 최신 값으로 교체한다.
    이러면 부하가 아무리 커져도 서버가 하는 일은 "한 번에 한 건"으로 묶이고,
    뒤처지면 중간 값이 빠질 뿐 최신 상태는 항상 반영된다.
    """

    def __init__(self) -> None:
        self._pending: dict | None = None
        self._ready = asyncio.Event()
        self.coalesced_count = 0

    def offer(self, sensor_data: dict) -> bool:
        """새 값을 넣는다. 대기 중인 값을 밀어냈으면 True."""
        replaced = self._pending is not None
        if replaced:
            self.coalesced_count += 1
        self._pending = sensor_data
        self._ready.set()
        return replaced

    async def take(self) -> dict:
        await self._ready.wait()
        sensor_data = self._pending
        self._pending = None
        self._ready.clear()
        # offer()가 _pending을 세팅한 뒤에만 _ready를 set하므로 None일 수 없다.
        assert sensor_data is not None
        return sensor_data


async def _drain_readings(
    websocket: WebSocket,
    user_id: int,
    place_id: int,
    slot: _LatestReadingSlot,
) -> None:
    """대기 중인 최신 센서값을 한 건씩 저장하는 워커.

    receive 루프와 분리돼 있어서, 저장이 오래 걸려도 게이트웨이가 보내는
    ping/command_result/device_state는 계속 처리된다. 특히 command_result가
    막히지 않는 게 중요하다 — 백그라운드 자동 제어가 기기에 명령을 보내고
    응답을 기다리는데, 예전 구조에서는 그 응답을 읽어줄 receive 루프가 바로
    이 저장을 기다리며 멈춰 있어서 정상 동작하는 기기도 매번 8초 타임아웃까지
    갔다(device_connection_hub.COMMAND_RESULT_TIMEOUT_SECONDS).
    """
    while True:
        sensor_data = await slot.take()

        try:
            saved = await save_reading_for_user(
                user_id=user_id,
                sensor_data_dict=sensor_data,
                place_id=place_id,
                reading_source="SENSOR",
            )
        except HTTPException as error:
            message: dict[str, Any] = {
                "type": "reading_error",
                "status": error.status_code,
                "detail": error.detail,
            }
        except asyncio.CancelledError:
            raise
        except Exception as error:
            print(
                "[센서 WebSocket] 센서값 저장 실패: "
                f"user_id={user_id}, place_id={place_id}, error={error}"
            )
            message = {
                "type": "reading_error",
                "status": 500,
                "detail": "센서 측정값을 저장하지 못했습니다.",
            }
        else:
            # save_reading_for_user()는 사용자 모든 장소에 팬아웃 저장하고
            # 대표 1건을 반환합니다. 아래 place_id는 이 소켓의 연결 장소입니다.
            message = {
                "type": "reading_saved",
                "place_id": place_id,
                "reading_id": saved.id,
                "measured_at": saved.measured_at.isoformat(),
                # 처리 중에 밀려서 버려진 값의 누적 개수. 0보다 크면 서버가
                # 발행 주기를 못 따라가고 있다는 신호다.
                "coalesced_skipped": slot.coalesced_count,
            }

        try:
            await device_hub.send_to_connection(
                websocket=websocket,
                user_id=user_id,
                message=message,
            )
        except DeviceConnectionError:
            # 연결이 교체됐거나 끊겼다. 이 워커는 이 연결 전용이므로 종료한다.
            return


async def _close_safely(
    websocket: WebSocket,
    code: int,
    reason: str = "",
) -> None:
    try:
        await websocket.close(code=code, reason=reason)
    except Exception:
        pass


async def _authenticate_connection(websocket: WebSocket) -> dict:
    """접속 직후 받은 토큰을 기존 HTTP 로그인 세션 방식으로 검증합니다."""

    try:
        message = await asyncio.wait_for(
            websocket.receive_json(),
            timeout=AUTH_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as error:
        raise HTTPException(
            status_code=401,
            detail="인증 시간이 초과되었습니다.",
        ) from error
    except Exception as error:
        raise HTTPException(
            status_code=401,
            detail="인증 메시지가 올바르지 않습니다.",
        ) from error

    message_type = message.get("type") if isinstance(message, dict) else None
    token = message.get("token") if isinstance(message, dict) else None
    if message_type != "auth" or not isinstance(token, str) or not token.strip():
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")

    # jh 수정함 - 게이트웨이 전용 기기 토큰도 허용한다(device_auth.py 참고).
    # 예전에는 사람의 세션 토큰만 받아서, 브라우저에서 로그아웃하면 그 순간
    # 게이트웨이의 WebSocket 인증도 같이 죽었다(sessions에서 같은 행이 지워짐).
    # 사람 세션도 그대로 통하므로 웹의 /ws/readings 연결은 영향이 없다.
    return await asyncio.to_thread(
        authenticate_device_or_user,
        token.strip(),
    )


async def _verify_place(user_id: int, place_id: int) -> None:
    """로그인 사용자가 해당 장소를 소유하는지 확인합니다."""

    await asyncio.to_thread(get_place_for_user, user_id, place_id)


@router.websocket("/ws/readings")
async def readings_websocket(websocket: WebSocket, place_id: int) -> None:
    """React가 선택 장소의 새 센서 기록을 실시간으로 구독합니다."""

    await websocket.accept()
    user_id: int | None = None

    try:
        try:
            user = await _authenticate_connection(websocket)
            user_id = int(user["id"])
            await _verify_place(user_id, place_id)
        except HTTPException as error:
            code = 4403 if error.status_code == 404 else 4401
            await _close_safely(websocket, code, str(error.detail))
            return
        except Exception:
            await _close_safely(
                websocket,
                1011,
                "인증 처리 중 오류가 발생했습니다.",
            )
            return

        reading_hub.connect(websocket, user_id, place_id)
        await websocket.send_json(
            {
                "type": "connected",
                "role": "web",
                "place_id": place_id,
            }
        )
        latest_device_state = reading_hub.latest_device_state_message(
            user_id=user_id,
            place_id=place_id,
        )
        if latest_device_state is not None:
            await websocket.send_json(latest_device_state)

        while True:
            message = await websocket.receive_json()
            if isinstance(message, dict) and message.get("type") == "ping":
                await websocket.send_json(
                    {
                        "type": "pong",
                        "place_id": place_id,
                    }
                )

    except WebSocketDisconnect:
        pass
    except Exception:
        await _close_safely(websocket, 1011)
    finally:
        if user_id is not None:
            reading_hub.disconnect(websocket, user_id, place_id)


@router.websocket("/ws/sensors")
async def sensors_websocket(websocket: WebSocket, place_id: int) -> None:
    """BLE 게이트웨이가 센서값을 보내고 같은 연결로 제어 명령을 받습니다."""

    await websocket.accept()
    user_id: int | None = None
    reading_slot = _LatestReadingSlot()
    reading_worker: asyncio.Task | None = None

    try:
        try:
            user = await _authenticate_connection(websocket)
            user_id = int(user["id"])
            await _verify_place(user_id, place_id)
        except HTTPException as error:
            code = 4403 if error.status_code == 404 else 4401
            await _close_safely(websocket, code, str(error.detail))
            return
        except Exception:
            await _close_safely(
                websocket,
                1011,
                "인증 처리 중 오류가 발생했습니다.",
            )
            return

        # 현재 제품 구조는 사용자당 물리 XIAO 1대입니다.
        # 새 연결이 들어오면 같은 사용자의 이전 연결은 자동으로 교체됩니다.
        await device_hub.connect(websocket, user_id, place_id)
        await device_hub.send_to_connection(
            websocket=websocket,
            user_id=user_id,
            message={
                "type": "connected",
                "role": "sensor",
                "place_id": place_id,
                "control_transport": "websocket",
                "capabilities": [
                    "sensor_reading",
                    "device_state",
                    "command_result",
                ],
            },
        )

        reading_worker = asyncio.create_task(
            _drain_readings(websocket, user_id, place_id, reading_slot)
        )

        while True:
            message: Any = await websocket.receive_json()

            if not isinstance(message, dict):
                await device_hub.send_to_connection(
                    websocket=websocket,
                    user_id=user_id,
                    message={
                        "type": "error",
                        "detail": "JSON 객체 형식으로 보내야 합니다.",
                    },
                )
                continue

            message_type = message.get("type")

            if message_type == "ping":
                await device_hub.send_to_connection(
                    websocket=websocket,
                    user_id=user_id,
                    message={
                        "type": "pong",
                        "place_id": place_id,
                    },
                )
                continue

            # XIAO 쪽 라이브러리가 서버 ping에 대한 pong을 직접 보내는 경우를
            # 허용합니다. 현재 서버가 능동 ping을 보내지는 않지만 오류로 막지 않습니다.
            if message_type == "pong":
                continue

            if message_type == "command_result":
                command_id = message.get("command_id")
                action = message.get("action")
                success = message.get("success")
                detail = message.get("detail")

                if (
                    not isinstance(command_id, str)
                    or not command_id
                    or not isinstance(action, str)
                    or not isinstance(success, bool)
                    or not isinstance(detail, str)
                ):
                    await device_hub.send_to_connection(
                        websocket=websocket,
                        user_id=user_id,
                        message={
                            "type": "error",
                            "detail": (
                                "command_result에는 command_id, 문자열 "
                                "action/detail과 불리언 success가 필요합니다."
                            ),
                        },
                    )
                    continue

                matched = await device_hub.resolve_command_result(
                    websocket=websocket,
                    user_id=user_id,
                    result=message,
                )
                print(
                    "[XIAO 명령 결과] "
                    f"user_id={user_id}, place_id={place_id}, "
                    f"command_id={command_id}, action={action}, "
                    f"success={success}, detail={detail}, "
                    f"matched={matched}"
                )
                continue

            if message_type == "device_state":
                try:
                    device_state = validate_device_state_data(
                        message.get("data")
                    )
                except DeviceStateContractError as error:
                    await device_hub.send_to_connection(
                        websocket=websocket,
                        user_id=user_id,
                        message={
                            "type": "error",
                            "detail": str(error),
                        },
                    )
                    continue

                await reading_hub.broadcast_device_state(
                    user_id=user_id,
                    state=device_state,
                )
                await device_hub.send_to_connection(
                    websocket=websocket,
                    user_id=user_id,
                    message={
                        "type": "device_state_forwarded",
                        "place_id": place_id,
                    },
                )
                continue

            if message_type != "sensor_reading":
                await device_hub.send_to_connection(
                    websocket=websocket,
                    user_id=user_id,
                    message={
                        "type": "error",
                        "detail": (
                            "type은 ping, pong, sensor_reading, device_state "
                            "또는 command_result여야 합니다."
                        ),
                    },
                )
                continue

            sensor_data = message.get("data")
            if not isinstance(sensor_data, dict):
                await device_hub.send_to_connection(
                    websocket=websocket,
                    user_id=user_id,
                    message={
                        "type": "error",
                        "detail": "data에 센서 측정값 객체가 필요합니다.",
                    },
                )
                continue

            # jh 수정함 - 이슈 #38. 여기서 저장을 await하지 않는다. 최신 값만
            # 슬롯에 남기고 바로 다음 메시지를 받으러 돌아간다 — 저장은
            # _drain_readings 워커가 한 건씩 처리한다.
            if reading_slot.offer(sensor_data):
                print(
                    "[센서 WebSocket] 앞선 센서값 저장이 아직 진행 중 — "
                    f"최신 값으로 대체했습니다(user_id={user_id}, "
                    f"place_id={place_id}, 누적 {reading_slot.coalesced_count}건)"
                )

    except WebSocketDisconnect:
        pass
    except DeviceConnectionError:
        # 새 연결로 교체됐거나 전송 중 연결이 끊긴 경우입니다.
        await _close_safely(websocket, 1011)
    except Exception as error:
        print(
            "[XIAO WebSocket] 처리 중 오류: "
            f"place_id={place_id}, error={error}"
        )
        await _close_safely(websocket, 1011)
    finally:
        if reading_worker is not None:
            reading_worker.cancel()
            # 진행 중이던 저장이 정리될 때까지 기다린다. 안 기다리면 이미 닫힌
            # 소켓으로 ack를 보내려다 나는 예외가 회수되지 않은 채 남는다.
            try:
                await reading_worker
            except asyncio.CancelledError:
                pass
            except Exception as error:
                print(f"[센서 WebSocket] 저장 워커 종료 중 오류: {error}")

        if user_id is not None:
            removed_current_connection = await device_hub.disconnect(
                websocket,
                user_id,
            )
            if removed_current_connection:
                await reading_hub.broadcast_device_disconnected(
                    user_id=user_id,
                )
