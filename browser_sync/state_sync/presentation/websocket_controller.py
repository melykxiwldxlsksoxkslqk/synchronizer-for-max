"""
WebSocket controller for state sync messages.
"""

from __future__ import annotations

from typing import Callable, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from browser_sync.state_sync.application.state_sync_service import StateSyncService


class SyncWebSocketController:
    """
    Handles websocket connection lifecycle and delegates business logic.
    """

    def __init__(
        self,
        service: StateSyncService,
        debug_logger: Optional[Callable[[str], None]] = None,
    ):
        self._service = service
        self._debug_logger = debug_logger

    def _debug(self, message: str) -> None:
        if not self._debug_logger:
            return
        try:
            self._debug_logger(message)
        except Exception:
            pass

    async def handle_connection(self, websocket: WebSocket, room_id: str) -> None:
        await self._service.register_connection(room_id, websocket)

        try:
            while True:
                payload = await websocket.receive_json()
                try:
                    await self._service.handle_message(room_id, websocket, payload)
                except ValueError as exc:
                    self._debug(f"[WS] value_error room={room_id}: {exc}")
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": str(exc),
                        }
                    )
                except Exception as exc:
                    self._debug(f"[WS] unexpected_error room={room_id}: {exc}")
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "Internal server error",
                        }
                    )
        except WebSocketDisconnect:
            self._debug(f"[WS] disconnect_event room={room_id}")
        finally:
            await self._service.unregister_connection(room_id, websocket)


def build_router(controller: SyncWebSocketController) -> APIRouter:
    router = APIRouter()

    @router.websocket("/ws/{room_id}")
    async def websocket_endpoint(websocket: WebSocket, room_id: str) -> None:
        await controller.handle_connection(websocket, room_id)

    return router

