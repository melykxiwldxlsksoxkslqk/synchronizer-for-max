"""
Domain models for synchronized field state.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


def _timestamp_ms() -> int:
    return int(time.time() * 1000)


@dataclass(frozen=True)
class SyncScope:
    """
    Update scope to prevent cross-page accidental apply.
    """

    origin: str
    path: str
    form_key: str = "no-form"

    @classmethod
    def from_payload(cls, payload: Dict[str, Any]) -> Optional["SyncScope"]:
        if not isinstance(payload, dict):
            return None
        raw_scope = payload.get("scope")
        if not isinstance(raw_scope, dict):
            return None

        origin = raw_scope.get("origin")
        path = raw_scope.get("path")
        form_key = raw_scope.get("formKey", "no-form")

        if not isinstance(origin, str) or not origin.strip():
            return None
        if not isinstance(path, str) or not path.strip():
            return None
        if not isinstance(form_key, str) or not form_key.strip():
            form_key = "no-form"

        return cls(
            origin=origin.strip(),
            path=path.strip(),
            form_key=form_key.strip(),
        )

    def to_dict(self) -> Dict[str, str]:
        return {
            "origin": self.origin,
            "path": self.path,
            "formKey": self.form_key,
        }


@dataclass(frozen=True)
class FieldUpdate:
    """
    Immutable input update event from a client session.
    """

    field_key: str
    value: str
    source_id: str
    scope: Optional[SyncScope] = None
    timestamp_ms: int = field(default_factory=_timestamp_ms)

    @classmethod
    def from_payload(cls, payload: Dict[str, Any]) -> "FieldUpdate":
        field_key = payload.get("fieldKey")
        source_id = payload.get("sourceId")
        raw_value = payload.get("value")

        if not isinstance(field_key, str) or not field_key.strip():
            raise ValueError("fieldKey must be a non-empty string")
        if not isinstance(source_id, str) or not source_id.strip():
            raise ValueError("sourceId must be a non-empty string")

        value = raw_value if isinstance(raw_value, str) else str(raw_value or "")

        return cls(
            field_key=field_key.strip(),
            value=value,
            source_id=source_id.strip(),
            scope=SyncScope.from_payload(payload),
        )

    def to_meta(self) -> Dict[str, Any]:
        meta: Dict[str, Any] = {
            "sourceId": self.source_id,
            "timestampMs": self.timestamp_ms,
        }
        if self.scope:
            meta["scope"] = self.scope.to_dict()
        return meta


@dataclass
class SessionState:
    """
    Mutable aggregate that stores room state and version.
    """

    room_id: str
    version: int = 0
    fields: Dict[str, str] = field(default_factory=dict)
    field_meta: Dict[str, Dict[str, Any]] = field(default_factory=dict)

    def apply(self, update: FieldUpdate) -> None:
        self.fields[update.field_key] = update.value
        self.field_meta[update.field_key] = update.to_meta()
        self.version += 1

    def snapshot(self) -> Dict[str, Any]:
        return {
            "roomId": self.room_id,
            "version": self.version,
            "fields": dict(self.fields),
            "fieldMeta": dict(self.field_meta),
        }

