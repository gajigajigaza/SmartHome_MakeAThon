# 파일 경로를 안전하게 만들기 위해 가져온다.
from pathlib import Path

# Python에 기본으로 포함된 SQLite 기능을 가져온다.
import sqlite3

# 여러 종류의 값을 포함하는 딕셔너리 타입에 사용한다.
from typing import Any


# database.py가 있는 폴더에 dudeoji.db 파일을 만든다.
DATABASE_PATH = (
    Path(__file__).resolve().parent
    / "dudeoji.db"
)


def get_connection() -> sqlite3.Connection:
    """
    SQLite 데이터베이스 연결을 만든다.

    각 데이터베이스 작업마다 새 연결을 생성하고,
    작업이 끝나면 연결을 닫는 방식으로 사용한다.
    """
    connection = sqlite3.connect(
        DATABASE_PATH,

        # DB가 잠겨 있을 경우 최대 10초 동안 기다린다.
        timeout=10,
    )

    # 조회 결과를 튜플이 아니라
    # 열 이름으로 접근 가능한 형태로 받는다.
    connection.row_factory = sqlite3.Row

    return connection


def initialize_database() -> None:
    """
    센서 기록 테이블이 없으면 새로 만든다.

    이미 테이블이 있다면 기존 데이터를 유지한다.
    """
    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sensor_readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,

                indoor_temperature REAL NOT NULL,
                indoor_humidity REAL NOT NULL,

                outdoor_temperature REAL NOT NULL,
                outdoor_humidity REAL NOT NULL,

                recommendation_action TEXT NOT NULL,
                recommendation_title TEXT NOT NULL,
                recommendation_summary TEXT NOT NULL,
                recommendation_reason TEXT NOT NULL,

                measured_at TEXT NOT NULL
            )
            """
        )

        connection.commit()


def convert_row_to_reading(
    row: sqlite3.Row,
) -> dict[str, Any]:
    """
    SQLite 조회 결과를 FastAPI 응답 형식으로 바꾼다.

    추천 정보는 recommendation 객체 안에 넣는다.
    """
    return {
        "id": row["id"],

        "indoor_temperature":
            row["indoor_temperature"],

        "indoor_humidity":
            row["indoor_humidity"],

        "outdoor_temperature":
            row["outdoor_temperature"],

        "outdoor_humidity":
            row["outdoor_humidity"],

        "measured_at":
            row["measured_at"],

        "recommendation": {
            "action":
                row["recommendation_action"],

            "title":
                row["recommendation_title"],

            "summary":
                row["recommendation_summary"],

            "reason":
                row["recommendation_reason"],
        },
    }


def insert_reading(
    sensor_data: dict[str, float],
    recommendation: dict[str, str],
    measured_at: str,
) -> dict[str, Any]:
    """
    새로운 센서값과 추천 결과를 SQLite에 저장한다.

    저장이 끝나면 생성된 전체 기록을 반환한다.
    """
    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO sensor_readings (
                indoor_temperature,
                indoor_humidity,
                outdoor_temperature,
                outdoor_humidity,
                recommendation_action,
                recommendation_title,
                recommendation_summary,
                recommendation_reason,
                measured_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sensor_data[
                    "indoor_temperature"
                ],

                sensor_data[
                    "indoor_humidity"
                ],

                sensor_data[
                    "outdoor_temperature"
                ],

                sensor_data[
                    "outdoor_humidity"
                ],

                recommendation["action"],
                recommendation["title"],
                recommendation["summary"],
                recommendation["reason"],

                measured_at,
            ),
        )

        connection.commit()

        # 방금 저장된 행의 자동 생성 ID를 가져온다.
        reading_id = cursor.lastrowid

        saved_row = connection.execute(
            """
            SELECT *
            FROM sensor_readings
            WHERE id = ?
            """,
            (reading_id,),
        ).fetchone()

    if saved_row is None:
        raise RuntimeError(
            "저장한 센서 기록을 다시 찾을 수 없습니다."
        )

    return convert_row_to_reading(saved_row)


def fetch_latest_reading() -> dict[str, Any] | None:
    """
    가장 최근에 저장된 센서 기록 한 개를 가져온다.

    기록이 없으면 None을 반환한다.
    """
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT *
            FROM sensor_readings
            ORDER BY id DESC
            LIMIT 1
            """
        ).fetchone()

    if row is None:
        return None

    return convert_row_to_reading(row)


def fetch_reading_history(
    limit: int,
) -> list[dict[str, Any]]:
    """
    최근 센서 기록을 지정한 개수만큼 가져온다.

    그래프가 시간 순서대로 그려지도록
    오래된 기록부터 최신 기록 순으로 반환한다.
    """
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT *
            FROM sensor_readings
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    # DB에서는 최신순으로 가져왔으므로
    # 화면에는 오래된 순서로 전달한다.
    rows.reverse()

    return [
        convert_row_to_reading(row)
        for row in rows
    ]


def count_readings() -> int:
    """
    데이터베이스에 저장된 전체 기록 수를 반환한다.
    """
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT COUNT(*) AS record_count
            FROM sensor_readings
            """
        ).fetchone()

    if row is None:
        return 0

    return int(row["record_count"])