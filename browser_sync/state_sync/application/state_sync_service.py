"""
Application service orchestrating room state synchronization.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from browser_sync.state_sync.domain.contracts import IConnectionHub, IStateRepository
from browser_sync.state_sync.domain.models import FieldUpdate


class StateSyncService:
    """
    Coordinates validation, state updates and delivery to clients.
    """

    def __init__(
        self,
        repository: IStateRepository,
        hub: IConnectionHub,
        debug_logger: Optional[Callable[[str], None]] = None,
    ):
        self._repository = repository
        self._hub = hub
        self._debug_logger = debug_logger

    def _debug(self, message: str) -> None:
        if not self._debug_logger:
            return
        try:
            self._debug_logger(message)
        except Exception:
            # Avoid breaking sync flow because of logging callback issues.
            pass

    async def register_connection(self, room_id: str, connection: Any) -> None:
        await self._hub.connect(room_id, connection)
        client = getattr(connection, "client", None)
        self._debug(f"[WS] connect room={room_id} client={client}")
        await self.send_snapshot(room_id, connection)

    async def unregister_connection(self, room_id: str, connection: Any) -> None:
        await self._hub.disconnect(room_id, connection)
        client = getattr(connection, "client", None)
        self._debug(f"[WS] disconnect room={room_id} client={client}")

    async def send_snapshot(self, room_id: str, connection: Any) -> None:
        snapshot = await self._repository.get_snapshot(room_id)
        fields_count = len(snapshot.get("fields", {}))
        version = snapshot.get("version", 0)
        self._debug(f"[WS] snapshot room={room_id} version={version} fields={fields_count}")
        await self._hub.send_to(
            connection,
            {
                "type": "snapshot",
                **snapshot,
            },
        )

    async def handle_message(
        self,
        room_id: str,
        connection: Any,
        payload: Dict[str, Any],
    ) -> None:
        if not isinstance(payload, dict):
            raise ValueError("Payload must be a JSON object")

        message_type = payload.get("type")

        if message_type == "request_snapshot":
            self._debug(f"[MSG] request_snapshot room={room_id}")
            await self.send_snapshot(room_id, connection)
            return

        if message_type == "field_changed":
            update = FieldUpdate.from_payload(payload)
            scope_str = (
                f"{update.scope.origin}{update.scope.path}#{update.scope.form_key}"
                if update.scope else
                "no-scope"
            )
            self._debug(
                f"[MSG] field_changed room={room_id} key={update.field_key} "
                f"scope={scope_str} source={update.source_id}"
            )
            state = await self._repository.apply_field_update(room_id, update)
            event_payload = {
                "type": "field_changed",
                "roomId": room_id,
                "version": state["version"],
                "fieldKey": update.field_key,
                "value": update.value,
                "sourceId": update.source_id,
                "timestampMs": update.timestamp_ms,
            }
            if update.scope:
                event_payload["scope"] = update.scope.to_dict()
            await self._hub.broadcast(
                room_id,
                event_payload,
                exclude=connection,
            )
            return

        if message_type == "debug_log":
            level = payload.get("level", "info")
            source = payload.get("source", "extension")
            message = payload.get("message", "")
            self._debug(
                f"[EXT:{level}] room={room_id} source={source} message={message}"
            )
            return

        raise ValueError(f"Unsupported message type: {message_type!r}")

