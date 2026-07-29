"""두더지 BLE ↔ FastAPI WebSocket 양방향 게이트웨이.

현재는 Windows 노트북에서 실행할 수 있고, 나중에 동일한 코드를
라즈베리파이로 옮겨 실행합니다.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import websockets
from bleak import BleakClient, BleakScanner
from dotenv import load_dotenv

from protocol import (
    BLE_DEVICE_NAME,
    CONTROL_CHARACTERISTIC_UUID,
    ProtocolError,
    RESULT_CHARACTERISTIC_UUID,
    SENSOR_CHARACTERISTIC_UUID,
    SERVICE_UUID,
    decode_json_message,
    failed_command_result,
    result_ble_to_server,
    sensor_ble_to_device_state,
    sensor_ble_to_server,
    server_command_to_ble,
)


LOGGER = logging.getLogger("dudeoji-gateway")


def _read_bool_environment(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default

    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(
        f"{name}은 true 또는 false여야 합니다."
    )


@dataclass(frozen=True, slots=True)
class Settings:
    websocket_url: str
    place_id: int
    auth_token: str
    ble_device_name: str
    ble_scan_timeout: float
    demo_fallback_bme: bool
    demo_temperature: float
    demo_humidity: float

    @classmethod
    def from_environment(cls) -> "Settings":
        load_dotenv()

        websocket_url = os.getenv(
            "DUDEOJI_WEBSOCKET_URL",
            "wss://dudeoji-makerthon.onrender.com/ws/sensors",
        ).strip()
        auth_token = os.getenv("DUDEOJI_AUTH_TOKEN", "").strip()
        ble_device_name = os.getenv(
            "DUDEOJI_BLE_DEVICE_NAME",
            BLE_DEVICE_NAME,
        ).strip()

        try:
            place_id = int(os.getenv("DUDEOJI_PLACE_ID", "1"))
        except ValueError as error:
            raise RuntimeError(
                "DUDEOJI_PLACE_ID는 1 이상의 정수여야 합니다."
            ) from error

        try:
            ble_scan_timeout = float(
                os.getenv("DUDEOJI_BLE_SCAN_TIMEOUT", "10")
            )
        except ValueError as error:
            raise RuntimeError(
                "DUDEOJI_BLE_SCAN_TIMEOUT은 숫자여야 합니다."
            ) from error

        demo_fallback_bme = _read_bool_environment(
            "DUDEOJI_DEMO_FALLBACK_BME",
            False,
        )
        try:
            demo_temperature = float(
                os.getenv("DUDEOJI_DEMO_TEMPERATURE", "25.0")
            )
            demo_humidity = float(
                os.getenv("DUDEOJI_DEMO_HUMIDITY", "50.0")
            )
        except ValueError as error:
            raise RuntimeError(
                "가상 BME 온도와 습도는 숫자여야 합니다."
            ) from error

        if not websocket_url.startswith(("ws://", "wss://")):
            raise RuntimeError(
                "DUDEOJI_WEBSOCKET_URL은 ws:// 또는 wss://여야 합니다."
            )
        if place_id < 1:
            raise RuntimeError(
                "DUDEOJI_PLACE_ID는 1 이상의 정수여야 합니다."
            )
        if not auth_token:
            raise RuntimeError(
                ".env의 DUDEOJI_AUTH_TOKEN을 설정해 주세요."
            )
        if not ble_device_name:
            raise RuntimeError(
                "DUDEOJI_BLE_DEVICE_NAME이 비어 있습니다."
            )
        if ble_scan_timeout <= 0:
            raise RuntimeError(
                "DUDEOJI_BLE_SCAN_TIMEOUT은 0보다 커야 합니다."
            )
        if not -50 <= demo_temperature <= 80:
            raise RuntimeError(
                "DUDEOJI_DEMO_TEMPERATURE는 -50~80 범위여야 합니다."
            )
        if not 0 <= demo_humidity <= 100:
            raise RuntimeError(
                "DUDEOJI_DEMO_HUMIDITY는 0~100 범위여야 합니다."
            )

        return cls(
            websocket_url=websocket_url,
            place_id=place_id,
            auth_token=auth_token,
            ble_device_name=ble_device_name,
            ble_scan_timeout=ble_scan_timeout,
            demo_fallback_bme=demo_fallback_bme,
            demo_temperature=demo_temperature,
            demo_humidity=demo_humidity,
        )

    def websocket_url_with_place(self) -> str:
        parts = urlsplit(self.websocket_url)
        query = dict(parse_qsl(parts.query, keep_blank_values=True))
        query["place_id"] = str(self.place_id)
        return urlunsplit(
            (
                parts.scheme,
                parts.netloc,
                parts.path,
                urlencode(query),
                parts.fragment,
            )
        )


class DudeojiGateway:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.stop_event = asyncio.Event()
        self.ble_ready = asyncio.Event()
        self.outbound_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(
            maxsize=200
        )
        self.ble_client: BleakClient | None = None
        self.event_loop: asyncio.AbstractEventLoop | None = None
        # 구버전 Render 서버와도 연결되도록 기본 기능만 가정합니다.
        # 새 서버가 인증 응답의 capabilities로 device_state를 광고하면
        # BME280 유무와 무관한 리드·릴레이 상태 전송을 자동 활성화합니다.
        self.server_capabilities: set[str] = {
            "sensor_reading",
            "command_result",
        }
        self._last_bme_available: bool | None = None
        self._device_state_unsupported_logged = False
        self._demo_fallback_logged = False

    async def run(self) -> None:
        self.event_loop = asyncio.get_running_loop()
        self._install_signal_handlers()

        LOGGER.info(
            "게이트웨이 시작: BLE=%s, Service=%s",
            self.settings.ble_device_name,
            SERVICE_UUID,
        )
        if self.settings.demo_fallback_bme:
            LOGGER.warning(
                "통신 시연용 가상 BME 활성화: %.1f°C / %.1f%%; "
                "최종 시연 전 false로 되돌리세요.",
                self.settings.demo_temperature,
                self.settings.demo_humidity,
            )

        tasks = [
            asyncio.create_task(
                self._run_ble_forever(),
                name="ble-loop",
            ),
            asyncio.create_task(
                self._run_websocket_forever(),
                name="websocket-loop",
            ),
        ]

        await self.stop_event.wait()
        LOGGER.info("종료 요청을 처리합니다.")

        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

        client = self.ble_client
        if client is not None and client.is_connected:
            await client.disconnect()

    def _install_signal_handlers(self) -> None:
        loop = asyncio.get_running_loop()
        for signal_name in ("SIGINT", "SIGTERM"):
            signal_value = getattr(signal, signal_name, None)
            if signal_value is None:
                continue
            try:
                loop.add_signal_handler(
                    signal_value,
                    self.stop_event.set,
                )
            except (NotImplementedError, RuntimeError):
                # Windows 기본 이벤트 루프에서는 지원하지 않을 수 있습니다.
                pass

    def _on_ble_disconnect(self, _: BleakClient) -> None:
        if self.event_loop is not None:
            self.event_loop.call_soon_threadsafe(self.ble_ready.clear)
        LOGGER.warning("XIAO BLE 연결이 끊겼습니다.")

    def _on_sensor_notification(
        self,
        _: Any,
        data: bytearray,
    ) -> None:
        try:
            message = decode_json_message(data)
            state_message = sensor_ble_to_device_state(message)
        except ProtocolError as error:
            LOGGER.warning("BLE 상태값 건너뜀: %s", error)
            return

        bme_available = state_message["data"]["bme_available"]
        if bme_available != self._last_bme_available:
            LOGGER.info(
                "BLE 센서 상태 수신: BME=%s, window_open=%s, fan_on=%s",
                "연결" if bme_available else "미연결",
                state_message["data"]["window_is_open"],
                state_message["data"]["ac_is_on"],
            )
            self._last_bme_available = bme_available

        if "device_state" in self.server_capabilities:
            self._enqueue_from_ble_callback(state_message)
        elif not self._device_state_unsupported_logged:
            LOGGER.info(
                "현재 서버는 device_state 기능을 광고하지 않아 "
                "리드·릴레이 단독 상태 전송을 보류합니다."
            )
            self._device_state_unsupported_logged = True

        fallback_temperature = None
        fallback_humidity = None
        if self.settings.demo_fallback_bme and not bme_available:
            fallback_temperature = self.settings.demo_temperature
            fallback_humidity = self.settings.demo_humidity
            if not self._demo_fallback_logged:
                LOGGER.warning(
                    "BME280 대신 가상값으로 sensor_reading을 전송합니다."
                )
                self._demo_fallback_logged = True

        try:
            reading_message = sensor_ble_to_server(
                message,
                fallback_temperature=fallback_temperature,
                fallback_humidity=fallback_humidity,
            )
        except ProtocolError:
            # BME 미연결은 device_state만 보내는 정상적인 부분 동작입니다.
            # 동일 경고를 주기적으로 반복하지 않습니다.
            return

        self._enqueue_from_ble_callback(reading_message)

    def _on_result_notification(
        self,
        _: Any,
        data: bytearray,
    ) -> None:
        try:
            message = decode_json_message(data)
            server_message = result_ble_to_server(message)
        except ProtocolError as error:
            LOGGER.warning("BLE 명령 결과 건너뜀: %s", error)
            return

        LOGGER.info(
            "XIAO BLE 명령 결과 수신: command_id=%s action=%s "
            "success=%s detail=%s",
            server_message.get("command_id"),
            server_message.get("action"),
            server_message.get("success"),
            server_message.get("detail"),
        )
        self._enqueue_from_ble_callback(server_message)

    def _enqueue_from_ble_callback(
        self,
        message: dict[str, Any],
    ) -> None:
        if self.event_loop is None:
            return

        def enqueue() -> None:
            try:
                message_type = message.get("type")
                if message_type in {"sensor_reading", "device_state"}:
                    # 서버가 잠시 끊긴 동안 센서 기록이 계속 쌓여 재연결 후
                    # 오래된 값이 한꺼번에 저장되지 않도록 종류별 최신 1건만
                    # 남깁니다. command_result는 제거하지 않습니다.
                    retained: list[dict[str, Any]] = []
                    while True:
                        try:
                            queued = self.outbound_queue.get_nowait()
                        except asyncio.QueueEmpty:
                            break
                        else:
                            self.outbound_queue.task_done()
                            if queued.get("type") != message_type:
                                retained.append(queued)

                    for queued in retained:
                        self.outbound_queue.put_nowait(queued)

                self.outbound_queue.put_nowait(message)
            except asyncio.QueueFull:
                LOGGER.error(
                    "서버 전송 대기열이 가득 차 메시지를 버립니다: %s",
                    message.get("type"),
                )

        self.event_loop.call_soon_threadsafe(enqueue)

    async def _run_ble_forever(self) -> None:
        retry_delay = 1.0

        while not self.stop_event.is_set():
            disconnect_event = asyncio.Event()

            try:
                LOGGER.info(
                    "BLE 검색 중: %s",
                    self.settings.ble_device_name,
                )
                device = await BleakScanner.find_device_by_filter(
                    lambda found, advertisement: (
                        found.name == self.settings.ble_device_name
                        or advertisement.local_name
                        == self.settings.ble_device_name
                        or SERVICE_UUID.lower()
                        in {
                            uuid.lower()
                            for uuid in (
                                advertisement.service_uuids or []
                            )
                        }
                    ),
                    timeout=self.settings.ble_scan_timeout,
                )

                if device is None:
                    raise RuntimeError("XIAO BLE 장치를 찾지 못했습니다.")

                def disconnected(client: BleakClient) -> None:
                    self._on_ble_disconnect(client)
                    if self.event_loop is not None:
                        self.event_loop.call_soon_threadsafe(
                            disconnect_event.set
                        )

                async with BleakClient(
                    device,
                    disconnected_callback=disconnected,
                ) as client:
                    self.ble_client = client
                    await client.start_notify(
                        SENSOR_CHARACTERISTIC_UUID,
                        self._on_sensor_notification,
                    )
                    await client.start_notify(
                        RESULT_CHARACTERISTIC_UUID,
                        self._on_result_notification,
                    )

                    self.ble_ready.set()
                    retry_delay = 1.0
                    LOGGER.info(
                        "XIAO BLE 연결 완료: %s",
                        device.address,
                    )

                    await disconnect_event.wait()

            except asyncio.CancelledError:
                raise
            except Exception as error:
                LOGGER.warning(
                    "BLE 연결 실패: %s; %.1f초 후 재시도",
                    error,
                    retry_delay,
                )
            finally:
                self.ble_ready.clear()
                self.ble_client = None

            await asyncio.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 15.0)

    async def _send_command_to_xiao(
        self,
        command: dict[str, Any],
    ) -> None:
        try:
            payload = server_command_to_ble(command)
        except ProtocolError as error:
            await self.outbound_queue.put(
                failed_command_result(command, str(error))
            )
            return

        client = self.ble_client
        if (
            client is None
            or not client.is_connected
            or not self.ble_ready.is_set()
        ):
            await self.outbound_queue.put(
                failed_command_result(
                    command,
                    "xiao_ble_not_connected",
                )
            )
            return

        try:
            await client.write_gatt_char(
                CONTROL_CHARACTERISTIC_UUID,
                payload,
                response=True,
            )
            LOGGER.info(
                "BLE 제어 명령 전달: command_id=%s action=%s",
                command.get("command_id"),
                command.get("action"),
            )
        except Exception as error:
            LOGGER.exception("BLE 제어 명령 전송 실패")
            await self.outbound_queue.put(
                failed_command_result(
                    command,
                    f"ble_write_failed:{type(error).__name__}",
                )
            )

    async def _authenticate_websocket(
        self,
        websocket: Any,
    ) -> dict[str, Any]:
        await websocket.send(
            json.dumps(
                {
                    "type": "auth",
                    "token": self.settings.auth_token,
                },
                ensure_ascii=False,
            )
        )

        raw = await asyncio.wait_for(websocket.recv(), timeout=15)
        message = decode_json_message(raw)

        if message.get("type") != "connected":
            raise RuntimeError(
                f"서버 인증 성공 응답이 아닙니다: {message}"
            )

        capabilities = message.get("capabilities")
        if isinstance(capabilities, list):
            self.server_capabilities = {
                item
                for item in capabilities
                if isinstance(item, str)
            }
        else:
            self.server_capabilities = {
                "sensor_reading",
                "command_result",
            }
        self._device_state_unsupported_logged = False

        LOGGER.info(
            "FastAPI WebSocket 인증 완료: role=%s, place_id=%s, "
            "capabilities=%s",
            message.get("role"),
            message.get("place_id"),
            ",".join(sorted(self.server_capabilities)),
        )
        return message

    async def _websocket_sender(self, websocket: Any) -> None:
        while True:
            message = await self.outbound_queue.get()

            try:
                await websocket.send(
                    json.dumps(message, ensure_ascii=False)
                )
                message_type = message.get("type")
                if message_type == "command_result":
                    LOGGER.info(
                        "명령 결과 WebSocket 전달 완료: command_id=%s "
                        "success=%s",
                        message.get("command_id"),
                        message.get("success"),
                    )
                else:
                    LOGGER.debug("WebSocket 전송: %s", message_type)
            except asyncio.CancelledError:
                self.outbound_queue.put_nowait(message)
                raise
            except Exception:
                # 재연결 후 다시 보낼 수 있도록 대기열 뒤에 되돌립니다.
                self.outbound_queue.put_nowait(message)
                raise
            finally:
                self.outbound_queue.task_done()

    async def _websocket_receiver(self, websocket: Any) -> None:
        async for raw in websocket:
            try:
                message = decode_json_message(raw)
            except ProtocolError as error:
                LOGGER.warning("서버 메시지 건너뜀: %s", error)
                continue

            message_type = message.get("type")

            if message_type == "device_command":
                await self._send_command_to_xiao(message)
            elif message_type == "reading_saved":
                LOGGER.info(
                    "센서값 저장 완료: reading_id=%s",
                    message.get("reading_id"),
                )
            elif message_type == "device_state_forwarded":
                LOGGER.debug("기기 상태 웹 전달 완료")
            elif message_type in {"reading_error", "error"}:
                LOGGER.error(
                    "서버 오류: %s",
                    message.get("detail"),
                )
            elif message_type == "pong":
                LOGGER.debug("서버 pong 수신")
            elif message_type == "connected":
                LOGGER.debug("중복 connected 메시지 수신")
            else:
                LOGGER.debug(
                    "처리하지 않는 서버 메시지: %s",
                    message_type,
                )

    async def _websocket_heartbeat(self, websocket: Any) -> None:
        while True:
            await asyncio.sleep(25)
            await websocket.send('{"type":"ping"}')

    async def _run_one_websocket_connection(self) -> None:
        url = self.settings.websocket_url_with_place()
        LOGGER.info("FastAPI WebSocket 연결 중: %s", url)

        async with websockets.connect(
            url,
            open_timeout=30,
            close_timeout=10,
            ping_interval=20,
            ping_timeout=20,
            max_size=64 * 1024,
        ) as websocket:
            await self._authenticate_websocket(websocket)

            tasks = [
                asyncio.create_task(
                    self._websocket_sender(websocket),
                    name="ws-sender",
                ),
                asyncio.create_task(
                    self._websocket_receiver(websocket),
                    name="ws-receiver",
                ),
                asyncio.create_task(
                    self._websocket_heartbeat(websocket),
                    name="ws-heartbeat",
                ),
            ]

            done, pending = await asyncio.wait(
                tasks,
                return_when=asyncio.FIRST_COMPLETED,
            )

            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)

            for task in done:
                exception = task.exception()
                if exception is not None:
                    raise exception

            raise RuntimeError("WebSocket 작업이 예기치 않게 종료되었습니다.")

    async def _run_websocket_forever(self) -> None:
        retry_delay = 1.0

        while not self.stop_event.is_set():
            try:
                await self._run_one_websocket_connection()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                LOGGER.warning(
                    "WebSocket 연결 실패: %s; %.1f초 후 재시도",
                    error,
                    retry_delay,
                )

            await asyncio.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 15.0)


def configure_logging() -> None:
    level_name = os.getenv("DUDEOJI_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


async def async_main() -> None:
    load_dotenv()
    configure_logging()
    settings = Settings.from_environment()
    gateway = DudeojiGateway(settings)
    await gateway.run()


def main() -> None:
    try:
        asyncio.run(async_main())
    except KeyboardInterrupt:
        pass
    except RuntimeError as error:
        raise SystemExit(f"설정 오류: {error}") from error


if __name__ == "__main__":
    main()
