"""Render를 거치지 않고 ESP-CONTROL에 BLE로 직접 device_command를 보내는 진단 스크립트.

이슈 #38(게이트웨이가 스트리밍 중이면 Render 백엔드 전체가 멎는 문제)로 웹
경유 명령 왕복이 불안정할 때, 서보/릴레이 명령 자체가 정상인지만 따로
검증하기 위한 용도. dudeoji-gateway.service를 실행 중이면 BLE 연결을
선점하고 있으므로 먼저 서비스를 멈추고 실행해야 한다.

사용 예:

    sudo systemctl stop dudeoji-gateway.service
    .venv/bin/python direct_ble_command_test.py OPEN_WINDOW
    .venv/bin/python direct_ble_command_test.py CLOSE_WINDOW
    sudo systemctl start dudeoji-gateway.service
"""

import asyncio
import json
import sys
import uuid

from bleak import BleakClient, BleakScanner

from protocol import (
    CONTROL_BLE_DEVICE_NAME,
    CONTROL_CHARACTERISTIC_UUID,
    RESULT_CHARACTERISTIC_UUID,
)


async def main(action: str) -> None:
    print(f"SCANNING for {CONTROL_BLE_DEVICE_NAME} ...")
    device = await BleakScanner.find_device_by_filter(
        lambda d, ad: d.name == CONTROL_BLE_DEVICE_NAME,
        timeout=10.0,
    )
    if device is None:
        print(f"DEVICE_NOT_FOUND: {CONTROL_BLE_DEVICE_NAME}")
        return

    result_event = asyncio.Event()

    def on_result(_, data: bytearray) -> None:
        print(f"RESULT_NOTIFY: {bytes(data).decode('utf-8', 'replace')}")
        result_event.set()

    async with BleakClient(device) as client:
        await client.start_notify(RESULT_CHARACTERISTIC_UUID, on_result)

        command_id = uuid.uuid4().hex
        payload = json.dumps(
            {"command_id": command_id, "action": action},
            separators=(",", ":"),
        ).encode("utf-8")

        print(f"SENDING command_id={command_id} action={action}")
        await client.write_gatt_char(
            CONTROL_CHARACTERISTIC_UUID,
            payload,
            response=True,
        )

        try:
            await asyncio.wait_for(result_event.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            print("NO_RESULT_NOTIFICATION_WITHIN_5S")


if __name__ == "__main__":
    action_arg = sys.argv[1] if len(sys.argv) > 1 else "OPEN_WINDOW"
    asyncio.run(main(action_arg))
