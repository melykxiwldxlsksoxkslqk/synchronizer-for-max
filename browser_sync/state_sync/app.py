"""
FastAPI application factory for state sync.
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable, Optional

from fastapi import FastAPI
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from browser_sync.state_sync.application.state_sync_service import StateSyncService
from browser_sync.state_sync.domain.models import FieldUpdate
from browser_sync.state_sync.infrastructure.in_memory_state_repository import (
    InMemoryStateRepository,
)
from browser_sync.state_sync.infrastructure.websocket_connection_hub import (
    WebSocketConnectionHub,
)
from browser_sync.state_sync.presentation.websocket_controller import (
    SyncWebSocketController,
    build_router,
)


def create_app(debug_logger: Optional[Callable[[str], None]] = None) -> FastAPI:
    repository = InMemoryStateRepository()
    hub = WebSocketConnectionHub()
    service = StateSyncService(
        repository=repository,
        hub=hub,
        debug_logger=debug_logger,
    )
    controller = SyncWebSocketController(
        service=service,
        debug_logger=debug_logger,
    )

    app = FastAPI(
        title="Browser Sync State Server",
        description="Room-based field synchronization over WebSocket",
        version="1.0.0",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def _debug(message: str) -> None:
        if not debug_logger:
            return
        try:
            debug_logger(message)
        except Exception:
            pass

    app.include_router(build_router(controller))

    @app.get("/api/state/{room_id}")
    async def get_room_state(room_id: str):
        snapshot = await repository.get_snapshot(room_id)
        return snapshot

    @app.post("/api/state/{room_id}/field")
    async def post_field_update(room_id: str, request: Request):
        payload = await request.json()
        update = FieldUpdate.from_payload(payload)
        state = await repository.apply_field_update(room_id, update)
        scope = update.scope.to_dict() if update.scope else {}
        _debug(
            f"[HTTP] field_changed room={room_id} key={update.field_key} "
            f"scope={scope} source={update.source_id}"
        )
        return {
            "ok": True,
            "roomId": room_id,
            "version": state.get("version", 0),
        }

    @app.post("/diag/log")
    async def diag_log(request: Request):
        payload = await request.body()
        message = payload.decode("utf-8", errors="replace").strip()
        if message:
            _debug(f"[EXT-HTTP] {message}")
        return {"ok": True}

    static_dir = Path(__file__).resolve().parents[2] / "state_sync_demo" / "web"
    if static_dir.exists():
        app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="demo")

    return app


app = create_app()

