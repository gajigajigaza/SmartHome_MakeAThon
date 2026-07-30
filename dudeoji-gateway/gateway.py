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
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx
import websockets
from bleak import BleakClient, BleakScanner
from dotenv import load_dotenv

import occupancy_detector
from protocol import (
    BLE_DEVICE_NAME,
    CAMERA_CHARACTERISTIC_UUID,
    CONTROL_BLE_DEVICE_NAME,
    CONTROL_CHARACTERISTIC_UUID,
    CONTROL_DEVICE_ID,
    ProtocolError,
    RESULT_CHARACTERISTIC_UUID,
    SENSE_BLE_DEVICE_NAME,
    SENSE_DEVICE_ID,
    SENSOR_CHARACTERISTIC_UUID,
    SERVICE_UUID,
    combined_sensor_to_server,
    control_ble_to_state,
    control_state_to_device_state,
    decode_camera_chunk,
    decode_json_message,
    environment_ble_to_server,
    environment_ble_to_state,
    failed_command_result,
    result_ble_to_server,
    sensor_ble_to_device_state,
    sensor_ble_to_server,
    server_command_to_ble,
)


LOGGER = logging.getLogger("dudeoji-gateway")
LEGACY_DEVICE_ID = "legacy-01"


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
    api_base_url: str
    sense_ble_name: str | None = None
    control_ble_name: str | None = None
    state_stale_after: float = 30.0

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
        sense_ble_name = (
            os.getenv("DUDEOJI_SENSE_BLE_NAME", "").strip() or None
        )
        control_ble_name = (
            os.getenv("DUDEOJI_CONTROL_BLE_NAME", "").strip() or None
        )

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
        try:
            state_stale_after = float(
                os.getenv("DUDEOJI_BLE_STATE_STALE_SECONDS", "30")
            )
        except ValueError as error:
            raise RuntimeError(
                "DUDEOJI_BLE_STATE_STALE_SECONDS는 숫자여야 합니다."
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
        if (
            sense_ble_name is not None
            and sense_ble_name == control_ble_name
        ):
            raise RuntimeError(
                "Sense와 Control BLE 이름은 서로 달라야 합니다."
            )
        if ble_scan_timeout <= 0:
            raise RuntimeError(
                "DUDEOJI_BLE_SCAN_TIMEOUT은 0보다 커야 합니다."
            )
        if state_stale_after <= 0:
            raise RuntimeError(
                "DUDEOJI_BLE_STATE_STALE_SECONDS는 0보다 커야 합니다."
            )
        if not -50 <= demo_temperature <= 80:
            raise RuntimeError(
                "DUDEOJI_DEMO_TEMPERATURE는 -50~80 범위여야 합니다."
            )
        if not 0 <= demo_humidity <= 100:
            raise RuntimeError(
                "DUDEOJI_DEMO_HUMIDITY는 0~100 범위여야 합니다."
            )

        api_base_url_override = os.getenv("DUDEOJI_API_BASE_URL", "").strip()
        if api_base_url_override:
            api_base_url = api_base_url_override.rstrip("/")
        else:
            # 재실감지 REST 호출(POST /api/occupancy/logs)은 기존
            # WebSocket과 같은 Render 백엔드를 향하므로, 별도 필수 env 없이
            # wss://.../ws/sensors -> https://호스트 로 유도한다.
            ws_parts = urlsplit(websocket_url)
            http_scheme = "https" if ws_parts.scheme == "wss" else "http"
            api_base_url = urlunsplit(
                (http_scheme, ws_parts.netloc, "", "", "")
            )
        if not api_base_url.startswith(("http://", "https://")):
            raise RuntimeError(
                "DUDEOJI_API_BASE_URL은 http:// 또는 https://여야 합니다."
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
            api_base_url=api_base_url,
            sense_ble_name=sense_ble_name,
            control_ble_name=control_ble_name,
            state_stale_after=state_stale_after,
        )

    @property
    def dual_ble_enabled(self) -> bool:
        return (
            self.sense_ble_name is not None
            and self.control_ble_name is not None
        )

    @property
    def sense_only_enabled(self) -> bool:
        return self.sense_ble_name is not None and self.control_ble_name is None

    @property
    def control_only_enabled(self) -> bool:
        return self.control_ble_name is not None and self.sense_ble_name is None

    @property
    def single_ble_enabled(self) -> bool:
        return self.sense_only_enabled or self.control_only_enabled

    def ble_devices(self) -> tuple[BleDeviceSpec, ...]:
        if self.dual_ble_enabled:
            return (
                BleDeviceSpec(
                    device_id=SENSE_DEVICE_ID,
                    ble_name=self.sense_ble_name or SENSE_BLE_DEVICE_NAME,
                    role="sense",
                ),
                BleDeviceSpec(
                    device_id=CONTROL_DEVICE_ID,
                    ble_name=(
                        self.control_ble_name or CONTROL_BLE_DEVICE_NAME
                    ),
                    role="control",
                ),
            )

        if self.sense_only_enabled:
            return (
                BleDeviceSpec(
                    device_id=SENSE_DEVICE_ID,
                    ble_name=self.sense_ble_name or SENSE_BLE_DEVICE_NAME,
                    role="sense",
                ),
            )

        if self.control_only_enabled:
            return (
                BleDeviceSpec(
                    device_id=CONTROL_DEVICE_ID,
                    ble_name=(
                        self.control_ble_name or CONTROL_BLE_DEVICE_NAME
                    ),
                    role="control",
                ),
            )

        return (
            BleDeviceSpec(
                device_id=LEGACY_DEVICE_ID,
                ble_name=self.ble_device_name,
                role="legacy",
            ),
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


@dataclass(frozen=True, slots=True)
class BleDeviceSpec:
    device_id: str
    ble_name: str
    role: str


@dataclass(frozen=True, slots=True)
class DeviceSnapshot:
    data: dict[str, Any]
    received_at: float


@dataclass(frozen=True, slots=True)
class OutboundItem:
    message: dict[str, Any]
    coalesce_key: tuple[str, str] | None = None


class DudeojiGateway:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.device_specs = {
            spec.device_id: spec
            for spec in settings.ble_devices()
        }
        self.stop_event = asyncio.Event()
        self.ble_ready = {
            device_id: asyncio.Event()
            for device_id in self.device_specs
        }
        self.ble_clients: dict[str, BleakClient | None] = {
            device_id: None
            for device_id in self.device_specs
        }
        self.device_connected = {
            device_id: False
            for device_id in self.device_specs
        }
        self.outbound_queue: asyncio.Queue[OutboundItem] = asyncio.Queue(
            maxsize=200,
        )
        self.event_loop: asyncio.AbstractEventLoop | None = None
        self.latest_states: dict[str, DeviceSnapshot] = {}
        self.sense_connected = False
        self.control_connected = False
        self.ina_available = False
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
        self._ble_scan_lock = asyncio.Lock()
        # 카메라 프레임 재조립 상태 — Sense 보드는 한 번에 한 프레임만
        # 전송하므로 device_id별이 아닌 단일 버퍼로 충분하다.
        self.camera_frame_queue: asyncio.Queue[bytes] = asyncio.Queue(
            maxsize=2,
        )
        self._camera_frame_id: int | None = None
        self._camera_buffer = bytearray()
        self._http_client: httpx.AsyncClient | None = None

    async def run(self) -> None:
        self.event_loop = asyncio.get_running_loop()
        self._install_signal_handlers()

        if self.settings.dual_ble_enabled:
            LOGGER.info(
                "게이트웨이 시작: mode=2-ESP, sense=%s, control=%s, "
                "Service=%s",
                self.settings.sense_ble_name,
                self.settings.control_ble_name,
                SERVICE_UUID,
            )
        elif self.settings.sense_only_enabled:
            LOGGER.info(
                "게이트웨이 시작: mode=Sense-only, sense=%s, Service=%s",
                self.settings.sense_ble_name,
                SERVICE_UUID,
            )
        elif self.settings.control_only_enabled:
            LOGGER.info(
                "게이트웨이 시작: mode=Control-only, control=%s, Service=%s",
                self.settings.control_ble_name,
                SERVICE_UUID,
            )
        else:
            LOGGER.info(
                "게이트웨이 시작: mode=1-ESP-compatible, BLE=%s, "
                "Service=%s",
                self.settings.ble_device_name,
                SERVICE_UUID,
            )
        if self.settings.demo_fallback_bme:
            if self.settings.dual_ble_enabled:
                LOGGER.warning(
                    "2-ESP 모드에서는 BME 미연결 시 sensor_reading을 "
                    "보내지 않으므로 가상 BME 설정을 사용하지 않습니다."
                )
            else:
                LOGGER.warning(
                    "통신 시연용 가상 BME 활성화: %.1f°C / %.1f%%; "
                    "최종 시연 전 false로 되돌리세요.",
                    self.settings.demo_temperature,
                    self.settings.demo_humidity,
                )

        tasks = [
            *[
                asyncio.create_task(
                    self._run_ble_forever(spec),
                    name=f"ble-{spec.device_id}",
                )
                for spec in self.device_specs.values()
            ],
            asyncio.create_task(
                self._run_websocket_forever(),
                name="websocket-loop",
            ),
        ]
        if self.settings.dual_ble_enabled or self.settings.sense_only_enabled:
            tasks.append(
                asyncio.create_task(
                    self._run_occupancy_forever(),
                    name="occupancy-loop",
                )
            )

        await self.stop_event.wait()
        LOGGER.info("종료 요청을 처리합니다.")

        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

        clients = [
            client
            for client in self.ble_clients.values()
            if client is not None and client.is_connected
        ]
        await asyncio.gather(
            *(client.disconnect() for client in clients),
            return_exceptions=True,
        )
        if self._http_client is not None:
            await self._http_client.aclose()

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

    def _set_device_connected(
        self,
        spec: BleDeviceSpec,
        connected: bool,
    ) -> None:
        previous = self.device_connected.get(spec.device_id, False)
        self.device_connected[spec.device_id] = connected
        if spec.role == "sense":
            self.sense_connected = connected
        elif spec.role == "control":
            self.control_connected = connected
            if not connected:
                self.ina_available = False
        else:
            self.sense_connected = connected
            self.control_connected = connected

        if previous != connected:
            LOGGER.info(
                "BLE 연결 상태: device_id=%s role=%s connected=%s "
                "sense_connected=%s control_connected=%s "
                "ina_available=%s",
                spec.device_id,
                spec.role,
                connected,
                self.sense_connected,
                self.control_connected,
                self.ina_available,
            )

    def _fresh_snapshot(
        self,
        device_id: str,
        *,
        now: float | None = None,
    ) -> DeviceSnapshot | None:
        if not self.device_connected.get(device_id, False):
            return None

        snapshot = self.latest_states.get(device_id)
        if snapshot is None:
            return None

        current_time = time.monotonic() if now is None else now
        if (
            current_time - snapshot.received_at
            > self.settings.state_stale_after
        ):
            return None
        return snapshot

    def _current_bme_available(
        self,
        *,
        now: float | None = None,
    ) -> bool:
        sense = self._fresh_snapshot(SENSE_DEVICE_ID, now=now)
        return bool(sense is not None and sense.data["bme_ok"])

    def _emit_dual_state_messages(self) -> None:
        sense = self._fresh_snapshot(SENSE_DEVICE_ID)
        control = self._fresh_snapshot(CONTROL_DEVICE_ID)
        if control is not None:
            state_message = control_state_to_device_state(
                control.data,
                bme_available=bool(
                    sense is not None and sense.data["bme_ok"]
                ),
            )
            self._enqueue_from_ble_callback(
                state_message,
                source_id=CONTROL_DEVICE_ID,
                data_kind="device_state",
            )

        if (
            sense is None
            or control is None
            or not sense.data["bme_ok"]
        ):
            return

        reading_message = combined_sensor_to_server(
            sense.data,
            control.data,
        )
        self._enqueue_from_ble_callback(
            reading_message,
            source_id=SENSE_DEVICE_ID,
            data_kind="combined_sensor_reading",
        )

    def _emit_single_state_message(self, device_id: str) -> None:
        snapshot = self._fresh_snapshot(device_id)
        if snapshot is None:
            return

        if device_id == SENSE_DEVICE_ID:
            self._enqueue_from_ble_callback(
                {
                    "type": "device_state",
                    "data": {
                        "window_is_open": False,
                        "ac_is_on": False,
                        "bme_available": bool(snapshot.data["bme_ok"]),
                        "sense_connected": True,
                        "control_connected": False,
                        "ina_available": False,
                        "gateway_connected": True,
                    },
                },
                source_id=SENSE_DEVICE_ID,
                data_kind="device_state",
            )
            if not snapshot.data["bme_ok"]:
                return
            message = environment_ble_to_server(snapshot.data)
            self._enqueue_from_ble_callback(
                message,
                source_id=SENSE_DEVICE_ID,
                data_kind="sensor_reading",
            )
            return

        if device_id == CONTROL_DEVICE_ID:
            self._enqueue_from_ble_callback(
                {
                    "type": "device_state",
                    "data": {
                        "window_is_open": snapshot.data["window_open"],
                        "ac_is_on": snapshot.data["fan_on"],
                        "bme_available": False,
                        "sense_connected": False,
                        "control_connected": True,
                        "ina_available": snapshot.data["ina_available"],
                        "gateway_connected": True,
                    },
                },
                source_id=CONTROL_DEVICE_ID,
                data_kind="device_state",
            )

    def _handle_device_disconnected(
        self,
        spec: BleDeviceSpec,
        disconnect_event: asyncio.Event,
    ) -> None:
        self.ble_ready[spec.device_id].clear()
        self.ble_clients[spec.device_id] = None
        self._set_device_connected(spec, False)
        LOGGER.warning(
            "BLE 연결 끊김: device_id=%s name=%s; 독립 재연결 대기",
            spec.device_id,
            spec.ble_name,
        )
        if self.settings.dual_ble_enabled and spec.role == "sense":
            self._emit_dual_state_messages()
        disconnect_event.set()

    def _on_ble_disconnect(
        self,
        spec: BleDeviceSpec,
        disconnect_event: asyncio.Event,
    ) -> None:
        if self.event_loop is not None:
            self.event_loop.call_soon_threadsafe(
                self._handle_device_disconnected,
                spec,
                disconnect_event,
            )

    def _on_legacy_sensor_notification(
        self,
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
            self._enqueue_from_ble_callback(
                state_message,
                source_id=LEGACY_DEVICE_ID,
                data_kind="device_state",
            )
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
            return

        self._enqueue_from_ble_callback(
            reading_message,
            source_id=LEGACY_DEVICE_ID,
            data_kind="sensor_reading",
        )

    def _on_sensor_notification(
        self,
        device_id: str,
        _: Any,
        data: bytearray,
    ) -> None:
        if not self.settings.dual_ble_enabled and not self.settings.single_ble_enabled:
            self._on_legacy_sensor_notification(data)
            return

        try:
            message = decode_json_message(data)
            if device_id == SENSE_DEVICE_ID:
                normalized = environment_ble_to_state(message)
                self.latest_states[device_id] = DeviceSnapshot(
                    data=normalized,
                    received_at=time.monotonic(),
                )
                LOGGER.info(
                    "Sense 상태 수신: bme=%s camera_ready=%s "
                    "person_detected=%s",
                    normalized["bme_ok"],
                    normalized["camera_ready"],
                    normalized["person_detected"],
                )
            elif device_id == CONTROL_DEVICE_ID:
                normalized = control_ble_to_state(message)
                self.latest_states[device_id] = DeviceSnapshot(
                    data=normalized,
                    received_at=time.monotonic(),
                )
                self.ina_available = normalized["ina_available"]
                LOGGER.info(
                    "Control 상태 수신: window_open=%s fan_on=%s "
                    "ina_available=%s",
                    normalized["window_open"],
                    normalized["fan_on"],
                    self.ina_available,
                )
            else:
                raise ProtocolError(
                    f"알 수 없는 BLE device_id입니다: {device_id}"
                )
        except ProtocolError as error:
            LOGGER.warning(
                "BLE 상태값 건너뜀: device_id=%s error=%s",
                device_id,
                error,
            )
            return

        if self.settings.dual_ble_enabled:
            self._emit_dual_state_messages()
        else:
            self._emit_single_state_message(device_id)

    def _on_camera_chunk_notification(
        self,
        _: Any,
        data: bytearray,
    ) -> None:
        try:
            chunk = decode_camera_chunk(data)
        except ProtocolError as error:
            LOGGER.warning("카메라 청크 무시: %s", error)
            return

        frame_id = chunk["frame_id"]
        if frame_id != self._camera_frame_id:
            self._camera_frame_id = frame_id
            self._camera_buffer = bytearray()

        self._camera_buffer.extend(chunk["payload"])

        if not chunk["is_last"]:
            return

        frame_bytes = bytes(self._camera_buffer)
        self._camera_buffer = bytearray()
        LOGGER.info(
            "카메라 프레임 수신 완료: frame_id=%s bytes=%d",
            frame_id,
            len(frame_bytes),
        )

        try:
            self.camera_frame_queue.put_nowait(frame_bytes)
        except asyncio.QueueFull:
            # 추론이 캡처 속도를 못 따라가면 오래된 프레임을 버리고
            # 최신 프레임으로 교체한다 — 재실감지는 최신성이 더 중요하다.
            try:
                self.camera_frame_queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            self.camera_frame_queue.put_nowait(frame_bytes)

    def _on_result_notification(
        self,
        device_id: str,
        _: Any,
        data: bytearray,
    ) -> None:
        if (
            (self.settings.dual_ble_enabled or self.settings.control_only_enabled)
            and device_id != CONTROL_DEVICE_ID
        ):
            LOGGER.warning(
                "Sense에서 수신된 명령 결과를 무시합니다: device_id=%s",
                device_id,
            )
            return

        try:
            message = decode_json_message(data)
            server_message = result_ble_to_server(message)
        except ProtocolError as error:
            LOGGER.warning("BLE 명령 결과 건너뜀: %s", error)
            return

        LOGGER.info(
            "Control BLE 명령 결과 수신: command_id=%s action=%s "
            "success=%s detail=%s",
            server_message.get("command_id"),
            server_message.get("action"),
            server_message.get("success"),
            server_message.get("detail"),
        )
        self._enqueue_from_ble_callback(
            server_message,
            source_id=device_id,
            data_kind="command_result",
            coalesce=False,
        )

    def _enqueue_nowait(self, item: OutboundItem) -> None:
        try:
            if item.coalesce_key is not None:
                retained: list[OutboundItem] = []
                while True:
                    try:
                        queued = self.outbound_queue.get_nowait()
                    except asyncio.QueueEmpty:
                        break
                    else:
                        self.outbound_queue.task_done()
                        if queued.coalesce_key != item.coalesce_key:
                            retained.append(queued)

                for queued in retained:
                    self.outbound_queue.put_nowait(queued)

            self.outbound_queue.put_nowait(item)
        except asyncio.QueueFull:
            LOGGER.error(
                "서버 전송 대기열이 가득 차 메시지를 버립니다: %s",
                item.message.get("type"),
            )

    def _enqueue_from_ble_callback(
        self,
        message: dict[str, Any],
        *,
        source_id: str,
        data_kind: str,
        coalesce: bool = True,
    ) -> None:
        if self.event_loop is None:
            return

        item = OutboundItem(
            message=message,
            coalesce_key=(
                (source_id, data_kind)
                if coalesce
                else None
            ),
        )
        self.event_loop.call_soon_threadsafe(self._enqueue_nowait, item)

    async def _find_ble_device(
        self,
        spec: BleDeviceSpec,
    ) -> Any:
        expected_name = spec.ble_name
        allow_service_fallback = spec.role == "legacy"

        async with self._ble_scan_lock:
            return await BleakScanner.find_device_by_filter(
                lambda found, advertisement: (
                    found.name == expected_name
                    or advertisement.local_name == expected_name
                    or (
                        allow_service_fallback
                        and SERVICE_UUID.lower()
                        in {
                            uuid.lower()
                            for uuid in (
                                advertisement.service_uuids or []
                            )
                        }
                    )
                ),
                timeout=self.settings.ble_scan_timeout,
            )

    async def _run_ble_forever(
        self,
        spec: BleDeviceSpec,
    ) -> None:
        retry_delay = 1.0

        while not self.stop_event.is_set():
            disconnect_event = asyncio.Event()

            try:
                LOGGER.info(
                    "BLE 검색 중: device_id=%s name=%s",
                    spec.device_id,
                    spec.ble_name,
                )
                device = await self._find_ble_device(spec)

                if device is None:
                    raise RuntimeError(
                        f"BLE 장치를 찾지 못했습니다: {spec.ble_name}"
                    )

                def disconnected(_: BleakClient) -> None:
                    self._on_ble_disconnect(spec, disconnect_event)

                def state_notification(
                    sender: Any,
                    data: bytearray,
                ) -> None:
                    self._on_sensor_notification(
                        spec.device_id,
                        sender,
                        data,
                    )

                def result_notification(
                    sender: Any,
                    data: bytearray,
                ) -> None:
                    self._on_result_notification(
                        spec.device_id,
                        sender,
                        data,
                    )

                def camera_notification(
                    sender: Any,
                    data: bytearray,
                ) -> None:
                    self._on_camera_chunk_notification(sender, data)

                async with BleakClient(
                    device,
                    disconnected_callback=disconnected,
                ) as client:
                    self.ble_clients[spec.device_id] = client
                    await client.start_notify(
                        SENSOR_CHARACTERISTIC_UUID,
                        state_notification,
                    )
                    if spec.role in {"control", "legacy"}:
                        await client.start_notify(
                            RESULT_CHARACTERISTIC_UUID,
                            result_notification,
                        )
                    if spec.role == "sense":
                        try:
                            await client.start_notify(
                                CAMERA_CHARACTERISTIC_UUID,
                                camera_notification,
                            )
                        except Exception as error:
                            # 펌웨어가 아직 카메라 characteristic을 갖기 전
                            # (배포 순서가 안 맞는 경우)이어도 환경/재실
                            # 텔레메트리는 그대로 동작해야 한다.
                            LOGGER.warning(
                                "카메라 characteristic 구독 실패(구버전 "
                                "펌웨어일 수 있음): %s",
                                error,
                            )

                    self.ble_ready[spec.device_id].set()
                    self._set_device_connected(spec, True)
                    retry_delay = 1.0
                    LOGGER.info(
                        "BLE 연결 완료: device_id=%s name=%s address=%s",
                        spec.device_id,
                        spec.ble_name,
                        device.address,
                    )

                    await disconnect_event.wait()

            except asyncio.CancelledError:
                raise
            except Exception as error:
                LOGGER.warning(
                    "BLE 연결 실패: device_id=%s name=%s error=%s; "
                    "%.1f초 후 재시도",
                    spec.device_id,
                    spec.ble_name,
                    error,
                    retry_delay,
                )
            finally:
                self.ble_ready[spec.device_id].clear()
                self.ble_clients[spec.device_id] = None
                self._set_device_connected(spec, False)

            await asyncio.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 15.0)

    def _get_http_client(self) -> httpx.AsyncClient:
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(
                base_url=self.settings.api_base_url,
                timeout=10.0,
            )
        return self._http_client

    async def _post_occupancy_log(
        self,
        person_detected: bool,
        confidence: float | None,
    ) -> None:
        payload: dict[str, Any] = {
            "place_id": self.settings.place_id,
            "person_detected": person_detected,
        }
        if confidence is not None:
            payload["confidence"] = confidence

        try:
            response = await self._get_http_client().post(
                "/api/occupancy/logs",
                json=payload,
                headers={
                    "Authorization": f"Bearer {self.settings.auth_token}",
                },
            )
            response.raise_for_status()
        except httpx.HTTPError as error:
            LOGGER.warning("재실감지 POST 실패: %s", error)
            return

        LOGGER.info(
            "재실감지 POST 완료: person_detected=%s confidence=%s",
            person_detected,
            confidence,
        )

    async def _process_camera_frame(self, frame_bytes: bytes) -> None:
        loop = asyncio.get_running_loop()
        person_detected, confidence = await loop.run_in_executor(
            None,
            occupancy_detector.detect,
            frame_bytes,
        )
        await self._post_occupancy_log(person_detected, confidence)

    async def _run_occupancy_forever(self) -> None:
        while not self.stop_event.is_set():
            frame_bytes = await self.camera_frame_queue.get()
            try:
                await self._process_camera_frame(frame_bytes)
            except asyncio.CancelledError:
                raise
            except Exception:
                # 한 프레임의 추론/전송 실패가 다음 프레임 처리를 막으면
                # 안 된다 — 카메라는 계속 새 프레임을 보내고 있다.
                LOGGER.exception("재실 감지 처리 실패, 다음 프레임으로 계속")

    async def _put_command_result(
        self,
        message: dict[str, Any],
    ) -> None:
        await self.outbound_queue.put(
            OutboundItem(message=message)
        )

    async def _send_command_to_xiao(
        self,
        command: dict[str, Any],
    ) -> None:
        try:
            payload = server_command_to_ble(command)
        except ProtocolError as error:
            await self._put_command_result(
                failed_command_result(command, str(error))
            )
            return

        if self.settings.sense_only_enabled:
            await self._put_command_result(
                failed_command_result(command, "control_ble_not_configured")
            )
            return

        target_device_id = (
            CONTROL_DEVICE_ID
            if self.settings.dual_ble_enabled or self.settings.control_only_enabled
            else LEGACY_DEVICE_ID
        )
        client = self.ble_clients.get(target_device_id)
        ready = self.ble_ready.get(target_device_id)
        if (
            client is None
            or not client.is_connected
            or ready is None
            or not ready.is_set()
        ):
            await self._put_command_result(
                failed_command_result(
                    command,
                    (
                        "control_ble_not_connected"
                        if self.settings.dual_ble_enabled or self.settings.control_only_enabled
                        else "xiao_ble_not_connected"
                    ),
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
                "BLE 제어 명령 전달: device_id=%s command_id=%s "
                "action=%s",
                target_device_id,
                command.get("command_id"),
                command.get("action"),
            )
        except Exception as error:
            LOGGER.exception("BLE 제어 명령 전송 실패")
            await self._put_command_result(
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
            item = await self.outbound_queue.get()
            message = item.message

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
                self.outbound_queue.put_nowait(item)
                raise
            except Exception:
                # 재연결 후 다시 보낼 수 있도록 대기열 뒤에 되돌립니다.
                self.outbound_queue.put_nowait(item)
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
        # jh 수정함 - retry_delay를 while 밖에서 한 번만 초기화해서 연결에
        # 성공해도 리셋되지 않았다. 그래서 초반 몇 번 실패해 15초까지 올라가면
        # 그 뒤로는 프로세스가 살아 있는 동안 재연결 대기가 영구히 15초로
        # 고정됐다 — 백엔드가 재시작될 때마다(Render 무료 플랜은 스핀다운·재시작이
        # 잦다) 그 15초 동안 device_hub에 연결이 없어서 버튼을 눌러도 503이
        # 즉시 떨어진다("눌렀는데 아무 일도 안 일어남"으로 보인다).
        # _run_ble_forever()는 이미 성공 시 리셋한다 — 같은 방식으로 맞춘다.
        retry_delay = 1.0

        while not self.stop_event.is_set():
            try:
                await self._run_one_websocket_connection()
                # 정상적으로 한 세션을 마치고 돌아온 경우(서버 재시작 등)는
                # 다음 재연결을 빠르게 시도해야 한다.
                retry_delay = 1.0
            except asyncio.CancelledError:
                raise
            except Exception as error:
                LOGGER.warning(
                    "WebSocket 연결 실패: %s; %.1f초 후 재시도",
                    error,
                    retry_delay,
                )
                retry_delay = min(retry_delay * 2, 15.0)

            await asyncio.sleep(min(retry_delay, 15.0))


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
