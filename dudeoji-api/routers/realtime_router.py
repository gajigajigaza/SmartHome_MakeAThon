"""센서 송신용·웹 구독용 WebSocket 엔드포인트.

센서(XIAO ESP32S3):
    /ws/sensors?place_id=장소ID

React 웹:
    /ws/readings?place_id=장소ID

두 연결 모두 접속 직후 첫 JSON 메시지로 로그인 토큰을 전송합니다.
    {"type": "auth", "token": "..."}
"""

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from auth_utils import get_current_user
from device_connection_hub import DeviceConnectionError, device_hub
from sensor_realtime_hub import reading_hub
from routers.readings_router import get_place_for_user, save_reading_for_user

router = APIRouter(tags=["realtime"])
AUTH_TIMEOUT_SECONDS = 10


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

    return await asyncio.to_thread(
        get_current_user,
        f"Bearer {token.strip()}",
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
    """XIAO가 센서값을 보내고 같은 연결로 제어 명령을 받습니다."""

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
            },
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

                if not isinstance(action, str) or not isinstance(success, bool):
                    await device_hub.send_to_connection(
                        websocket=websocket,
                        user_id=user_id,
                        message={
                            "type": "error",
                            "detail": (
                                "command_result에는 문자열 action과 "
                                "불리언 success가 필요합니다."
                            ),
                        },
                    )
                    continue

                print(
                    "[XIAO 명령 결과] "
                    f"user_id={user_id}, place_id={place_id}, "
                    f"command_id={command_id}, action={action}, "
                    f"success={success}, detail={detail}"
                )
                continue

            if message_type != "sensor_reading":
                await device_hub.send_to_connection(
                    websocket=websocket,
                    user_id=user_id,
                    message={
                        "type": "error",
                        "detail": (
                            "type은 ping, pong, sensor_reading 또는 "
                            "command_result여야 합니다."
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

            try:
                saved = await save_reading_for_user(
                    user_id=user_id,
                    sensor_data_dict=sensor_data,
                    place_id=place_id,
                    reading_source="SENSOR",
                )
            except HTTPException as error:
                await device_hub.send_to_connection(
                    websocket=websocket,
                    user_id=user_id,
                    message={
                        "type": "reading_error",
                        "status": error.status_code,
                        "detail": error.detail,
                    },
                )
                continue
            except Exception:
                await device_hub.send_to_connection(
                    websocket=websocket,
                    user_id=user_id,
                    message={
                        "type": "reading_error",
                        "status": 500,
                        "detail": "센서 측정값을 저장하지 못했습니다.",
                    },
                )
                continue

            # save_reading_for_user()는 사용자 모든 장소에 팬아웃 저장하고
            # 대표 1건을 반환합니다. 아래 place_id는 이 소켓의 연결 장소입니다.
            await device_hub.send_to_connection(
                websocket=websocket,
                user_id=user_id,
                message={
                    "type": "reading_saved",
                    "place_id": place_id,
                    "reading_id": saved.id,
                    "measured_at": saved.measured_at.isoformat(),
                },
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
        if user_id is not None:
            await device_hub.disconnect(websocket, user_id)
