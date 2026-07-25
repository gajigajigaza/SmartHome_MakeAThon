from main import app
from routers.realtime_router import router as realtime_router


# 최종 app에 실제로 등록된 WebSocket 경로만 확인합니다.
existing_websocket_paths = {
    getattr(route, "path", None)
    for route in app.routes
    if "WebSocket" in type(route).__name__
}

# realtime_router 내부의 각 WebSocket 경로를 개별적으로 등록합니다.
# 이미 존재하는 WebSocket 경로는 중복 등록하지 않습니다.
for route in realtime_router.routes:
    route_path = getattr(route, "path", None)
    route_type = type(route).__name__

    if "WebSocket" in route_type and route_path not in existing_websocket_paths:
        app.router.routes.append(route)
        existing_websocket_paths.add(route_path)
