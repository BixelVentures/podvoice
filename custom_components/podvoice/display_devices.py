"""Non-authoritative HA registry projection of validated enrolled browser profiles."""

from __future__ import annotations

import json

from .controller_admin import _valid_result


class DisplayDevices:
    """No polling, authorization, timer registration or physical-device inference."""

    def __init__(self, registry, entry_id: str):
        self.registry = registry
        self.entry_id = entry_id

    def apply(self, action: str, room: str, result: dict) -> None:
        if action not in {"list", "revoke", "revoke_identity"} or not _valid_result(
            action, room, result
        ):
            return
        # JSON escaping makes entry/room scopes unambiguous even with punctuation.
        prefix = "display:" + json.dumps([self.entry_id, room], separators=(",", ":")) + ":"
        keep = set()
        if action == "list":
            rows = result["enrolled"]
            if len({row["id"] for row in rows}) != len(rows):
                return  # Conflicting duplicate identities cannot replace an honest projection.
            for row in rows:
                identifier = ("podvoice", prefix + row["id"])
                keep.add(identifier)
                existing = next(
                    (
                        device
                        for device in self.registry.devices.values()
                        if identifier in device.identifiers
                    ),
                    None,
                )
                if existing is not None and (
                    {item for item in existing.identifiers if item[0] == "podvoice"} != {identifier}
                    or existing.config_entries - {self.entry_id}
                ):
                    continue  # A merged/shared device is not ours to rename or reclassify.
                self.registry.async_get_or_create(
                    config_entry_id=self.entry_id,
                    identifiers={identifier},
                    name=row["name"] or "PodView browserprofil",
                    manufacturer="PodVoice",
                    model="PodView browser profile",
                )
        for device in tuple(self.registry.devices.values()):
            if self.entry_id not in device.config_entries:
                continue
            owned = {
                identifier
                for identifier in device.identifiers
                if identifier[0] == "podvoice" and identifier[1].startswith(prefix)
            }
            if not owned:
                continue
            if action == "revoke_identity":
                remove = ("podvoice", prefix + result["identity"]) in owned
            else:
                remove = not owned.intersection(keep)
            podvoice_ids = {item for item in device.identifiers if item[0] == "podvoice"}
            if remove and len(owned) == 1 and podvoice_ids == owned:
                # Detach only this presentation's entry. Never revoke browser access,
                # delete other integrations' devices, or register a timer handler.
                self.registry.async_update_device(device.id, remove_config_entry_id=self.entry_id)
