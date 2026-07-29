"""실물 센서 없이 Render WebSocket의 기기 상태 전달을 검증합니다.

테스트는 같은 로그인 토큰으로 웹 구독자와 센서 역할을 각각 연결하고,
가상 device_state 한 건이 FastAPI를 거쳐 웹 구독자에게 도착하는지
확인합니다. sensor_reading은 보내지 않으므로 DB 센서 기록은 생성하지
않습니다.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import websockets

from check_gateway_env import ENV_PATH, load_entries
from gateway import DudeojiGateway, Settings as GatewaySettings
from protocol import decode_json_message


MESSAGE_TIMEOUT_SECONDS = 15.0


@dataclass(frozen=True, slots=True)
class LiveTestSettings:
    sensor_url: str
    readings_url: str
    place_id: int
    auth_token: str

    @classmethod
    def from_env_file(cls, path: Path = ENV_PATH) -> "LiveTestSettings":
        if not path.is_file():
            raise RuntimeError(f".env 파일이 없습니다: {path}")

        entries, duplicates = load_entries(path)
        if duplicates:
            duplicate_names = ", ".join(sorted(set(duplicates)))
            raise RuntimeError(f".env에 중복 키가 있습니다: {duplicate_names}")

        base_url = entries.get(
            "DUDEOJI_WEBSOCKET_URL",
            "wss://dudeoji-makerthon.onrender.com/ws/sensors",
        )
        token = entries.get("DUDEOJI_AUTH_TOKEN", "")

        try:
            place_id = int(entries.get("DUDEOJI_PLACE_ID", ""))
        except ValueError as error:
            raise RuntimeError("DUDEOJI_PLACE_ID는 정수여야 합니다.") from error

        if not base_url.startswith(("ws://", "wss://")):
            raise RuntimeError(
                "DUDEOJI_WEBSOCKET_URL은 ws:// 또는 wss://여야 합니다."
            )
        if place_id < 1:
            raise RuntimeError("DUDEOJI_PLACE_ID는 1 이상이어야 합니다.")
        if not token:
            raise RuntimeError("DUDEOJI_AUTH_TOKEN이 비어 있습니다.")

        return cls(
            sensor_url=build_role_url(base_url, "sensors", place_id),
            readings_url=build_role_url(base_url, "readings", place_id),
            place_id=place_id,
            auth_token=token,
        )


def build_role_url(
    base_url: str,
    role: str,
    place_id: int,
) -> str:
    if role not in {"sensors", "readings"}:
        raise ValueError(f"지원하지 않는 WebSocket 역할입니다: {role}")

    parts = urlsplit(base_url)
    parent_path = parts.path.rstrip("/").rsplit("/", 1)[0]
    target_path = f"{parent_path}/{role}"
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["place_id"] = str(place_id)

    return urlunsplit(
        (
            parts.scheme,
            parts.netloc,
            target_path,
            urlencode(query),
            parts.fragment,
        )
    )


def choose_test_state(
    previous_message: dict[str, Any] | None,
) -> dict[str, bool]:
    previous_data = (
        previous_message.get("data")
        if isinstance(previous_message, dict)
        else None
    )
    previous_data = previous_data if isinstance(previous_data, dict) else {}

    previous_window = previous_data.get("window_is_open")
    previous_aircon = previous_data.get("ac_is_on")

    return {
        "window_is_open": (
            not previous_window
            if isinstance(previous_window, bool)
            else True
        ),
        "ac_is_on": (
            not previous_aircon
            if isinstance(previous_aircon, bool)
            else False
        ),
        "bme_available": False,
    }


def device_state_matches(
    message: dict[str, Any],
    *,
    place_id: int,
    expected_state: dict[str, bool],
) -> bool:
    data = message.get("data")
    if (
        message.get("type") != "device_state"
        or message.get("place_id") != place_id
        or not isinstance(data, dict)
    ):
        return False

    return all(data.get(key) is value for key, value in expected_state.items())


async def receive_until(
    websocket: Any,
    predicate: Callable[[dict[str, Any]], bool],
    *,
    description: str,
    timeout: float = MESSAGE_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout

    while True:
        remaining = deadline - loop.time()
        if remaining <= 0:
            raise TimeoutError(f"{description} 수신 시간이 초과되었습니다.")

        try:
            raw = await asyncio.wait_for(websocket.recv(), timeout=remaining)
        except asyncio.TimeoutError as error:
            raise TimeoutError(
                f"{description} 수신 시간이 초과되었습니다."
            ) from error

        message = decode_json_message(raw)
        if predicate(message):
            return message


async def authenticate(
    websocket: Any,
    *,
    token: str,
    expected_role: str,
) -> dict[str, Any]:
    await websocket.send(
        json.dumps(
            {
                "type": "auth",
                "token": token,
            },
            ensure_ascii=False,
        )
    )
    message = await receive_until(
        websocket,
        lambda item: item.get("type") == "connected",
        description=f"{expected_role} 인증 응답",
    )

    if message.get("role") != expected_role:
        raise RuntimeError(
            f"{expected_role} 대신 {message.get('role')} 역할로 연결되었습니다."
        )
    return message


async def receive_cached_device_state(
    websocket: Any,
) -> dict[str, Any] | None:
    try:
        return await receive_until(
            websocket,
            lambda item: item.get("type") == "device_state",
            description="기존 기기 상태",
            timeout=0.5,
        )
    except TimeoutError:
        return None


async def run_live_test(
    settings: LiveTestSettings,
    gateway_settings: GatewaySettings,
) -> None:
    connection_options = {
        "open_timeout": 30,
        "close_timeout": 10,
        "ping_interval": 20,
        "ping_timeout": 20,
        "max_size": 64 * 1024,
    }

    print(
        "SENSORLESS_LIVE_TEST_START "
        f"place_id={settings.place_id}"
    )

    async with websockets.connect(
        settings.readings_url,
        **connection_options,
    ) as web_socket:
        web_connected = await authenticate(
            web_socket,
            token=settings.auth_token,
            expected_role="web",
        )
        print(
            "WEB_WEBSOCKET_OK "
            f"role={web_connected.get('role')} "
            f"place_id={web_connected.get('place_id')}"
        )

        cached_state = await receive_cached_device_state(web_socket)
        test_state = choose_test_state(cached_state)

        gateway = DudeojiGateway(gateway_settings)
        gateway_sensor_url = gateway_settings.websocket_url_with_place()
        if gateway_sensor_url != settings.sensor_url:
            raise RuntimeError(
                "라이브 테스트와 실제 게이트웨이의 센서 URL이 다릅니다."
            )

        async with websockets.connect(
            gateway_sensor_url,
            **connection_options,
        ) as sensor_socket:
            sensor_connected = await gateway._authenticate_websocket(
                sensor_socket
            )
            capabilities = gateway.server_capabilities
            if "device_state" not in capabilities:
                raise RuntimeError(
                    "Render 센서 WebSocket이 device_state 기능을 "
                    "광고하지 않습니다."
                )

            print(
                "RENDER_SENSOR_WEBSOCKET_OK "
                f"role={sensor_connected.get('role')} "
                f"place_id={sensor_connected.get('place_id')} "
                "capability=device_state"
            )

            await gateway.outbound_queue.put(
                {
                    "type": "device_state",
                    "data": test_state,
                }
            )
            sender_task = asyncio.create_task(
                gateway._websocket_sender(sensor_socket),
                name="sensorless-test-gateway-sender",
            )
            try:
                forwarded_task = asyncio.create_task(
                    receive_until(
                        sensor_socket,
                        lambda item: (
                            item.get("type") == "device_state_forwarded"
                            and item.get("place_id") == settings.place_id
                        ),
                        description="Render 기기 상태 전달 확인",
                    )
                )
                web_state_task = asyncio.create_task(
                    receive_until(
                        web_socket,
                        lambda item: device_state_matches(
                            item,
                            place_id=settings.place_id,
                            expected_state=test_state,
                        ),
                        description="웹 기기 상태",
                    )
                )
                _, web_state = await asyncio.gather(
                    forwarded_task,
                    web_state_task,
                )
            finally:
                sender_task.cancel()
                await asyncio.gather(sender_task, return_exceptions=True)

            state_data = web_state["data"]
            if state_data.get("gateway_connected") is not True:
                raise RuntimeError(
                    "웹 device_state의 gateway_connected가 true가 아닙니다."
                )
            if not state_data.get("received_at"):
                raise RuntimeError(
                    "웹 device_state에 received_at이 없습니다."
                )

            print(
                "WEB_DEVICE_STATE_OK "
                f"window_is_open={state_data['window_is_open']} "
                f"ac_is_on={state_data['ac_is_on']} "
                f"bme_available={state_data['bme_available']} "
                "gateway_connected=true"
            )

    print("SENSORLESS_LIVE_TEST_OK db_sensor_reading_created=false")


def main() -> None:
    try:
        settings = LiveTestSettings.from_env_file()
        gateway_settings = GatewaySettings.from_environment()
        asyncio.run(run_live_test(settings, gateway_settings))
    except KeyboardInterrupt:
        raise SystemExit(130) from None
    except Exception as error:
        raise SystemExit(
            f"SENSORLESS_LIVE_TEST_FAILED: {error}"
        ) from error


if __name__ == "__main__":
    main()
