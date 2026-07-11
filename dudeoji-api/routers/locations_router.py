"""위치(집/회사 등) 저장·조회·선택 API.

담당: 정현(나)
추가 예정 — 아직 실제 엔드포인트는 없습니다.

⚠️ 시작 전에 류은과 먼저 상의하세요: places_router.py의 `places` 테이블이
이미 "장소 여러 개(집/회사 등)"를 다루고 있습니다. 완전히 새로운
위치 테이블/엔드포인트를 만들기보다, `places` 테이블에 위경도나
날씨 조회용 지역 코드 컬럼을 추가해서 재사용하는 게 나을 수 있습니다.
(자세한 내용은 TEAM_STRUCTURE.md '6. 나중에 만들 때 주의할 것' 참고)

완성되면 features/location/useSelectedLocation.js가 지금 localStorage에
하던 걸 아래 엔드포인트로 대체할 예정입니다:

    GET  /api/locations        - 내 위치 목록 조회
    POST /api/locations        - 위치 추가 (이름 + 위경도)
    PATCH /api/locations/{id}/select  - 선택된 위치 변경

이 라우터는 아직 main.py에 연결(`include_router`)하지 않았습니다.
엔드포인트를 채운 뒤 main.py에 한 줄 추가하면 됩니다.
"""
from fastapi import APIRouter

router = APIRouter(prefix="/api/locations", tags=["locations"])

# TODO(정현): places_router.py와의 통합 방향 정해지면 엔드포인트 작성
