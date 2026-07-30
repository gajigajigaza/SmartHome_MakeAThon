"""프로필(뱃지) 잠금 상태 API.

badges.py의 get_badge_states()가 계산한 id별 unlocked/progress를 그대로
내려준다. 이름/설명/아이콘 같은 표시용 메타데이터는 프론트
shared/profileBadges.jsx가 id로 들고 있으니 여기서는 안 내려보낸다.
"""
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth_utils import get_current_user
from badges import get_badge_states

router = APIRouter(prefix="/api", tags=["badges"])


class BadgeProgress(BaseModel):
    current: float
    target: float


class BadgeState(BaseModel):
    id: str
    unlocked: bool
    progress: Optional[BadgeProgress] = None


class BadgesResponse(BaseModel):
    badges: list[BadgeState]


@router.get("/badges", response_model=BadgesResponse)
def read_badges(current_user: dict = Depends(get_current_user)):
    return {"badges": get_badge_states(current_user["id"])}
