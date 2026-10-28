"""Explicit browser enrollment; it can renew short grants, never execute actions."""

from __future__ import annotations

import fcntl
import hashlib
import json
import math
import os
import re
import secrets
import stat
import time
from pathlib import Path

_AREA_ID = re.compile(r"[A-Za-z0-9_-]{1,128}")
_PLACEMENT_MAX = 2**53 - 1


class ContinuityDenied(ValueError):
    pass


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ContinuityDenied("duplicate registry field")
        result[key] = value
    return result


class ControllerRegistry:
    """At most two active browser profiles per room, with durable revocation.

    Only explicit one-use administrator pairing may create a missing registry.
    All subsequent reads require it; corruption never becomes empty authority.
    Advisory locks are nonblocking so a stalled administrator cannot block audio.
    """

    def __init__(self, path: Path, generation: str, days: int):
        if (
            not re.fullmatch(r"[a-f0-9]{64}", generation)
            or type(days) is not int
            or not 1 <= days <= 30
        ):
            raise ContinuityDenied("invalid continuity configuration")
        self.path, self.generation, self.days = path, generation, days
        self._vehicle_owner_fd: int | None = None
        self._vehicle_owner_pid: int | None = None
        self.wall, self.mono = time.time(), time.monotonic()

    def _now(self):
        now = time.time()
        if not math.isfinite(now) or now + 1 < self.wall + time.monotonic() - self.mono:
            raise ContinuityDenied("clock rollback")
        return now

    def _open(self):
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        directory = self.path.parent.stat()
        if (
            self.path.parent.is_symlink()
            or not stat.S_ISDIR(directory.st_mode)
            or directory.st_mode & 0o077
            or directory.st_uid != os.geteuid()
        ):
            raise ContinuityDenied("invalid registry directory")
        fd = os.open(self.path.with_suffix(".lock"), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BaseException:
            os.close(fd)
            raise
        return fd

    def _load(self, *, create=False):
        now = self._now()
        try:
            fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW)
        except FileNotFoundError:
            if create:
                return {
                    "schema": 4,
                    "generation": self.generation,
                    "highWater": now,
                    "records": {},
                    "vehicleRisk": {},
                }
            raise ContinuityDenied("missing registry") from None
        with os.fdopen(fd, "r") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_size > 262144:
                raise ContinuityDenied("invalid registry")
            data = json.load(stream, object_pairs_hook=_object)
        if (
            not isinstance(data, dict)
            or set(data)
            != (
                {"schema", "generation", "highWater", "records", "vehicleRisk"}
                if data.get("schema") == 4
                else {"schema", "generation", "highWater", "records"}
            )
            or type(data["schema"]) is not int
            or data["schema"] not in (1, 2, 3, 4)
            or data["generation"] != self.generation
            or type(data["highWater"]) not in (float, int)
            or not math.isfinite(data["highWater"])
            or now < data["highWater"]
            or not isinstance(data["records"], dict)
            or len(data["records"]) > 256
        ):
            raise ContinuityDenied("invalid registry or clock")
        legacy = data["schema"] == 1
        unplaced = data["schema"] in (1, 2)
        for key, row in data["records"].items():
            if (
                not re.fullmatch(r"[a-f0-9]{32}", key)
                or not isinstance(row, dict)
                or set(row)
                != (
                    {"digest", "room", "pin", "issuedAt", "expiresAt", "revoked"}
                    if legacy
                    else {
                        "digest",
                        "room",
                        "pin",
                        "issuedAt",
                        "expiresAt",
                        "revoked",
                        "name",
                        "persistent",
                    }
                    | (set() if unplaced else {"areaId", "placementRevision"})
                )
                or not isinstance(row["room"], str)
                or not 1 <= len(row["room"]) <= 160
                or not isinstance(row["digest"], str)
                or not re.fullmatch(r"[a-f0-9]{64}", row["digest"])
                or not isinstance(row["pin"], str)
                or not re.fullmatch(r"[a-f0-9]{64}", row["pin"])
                or type(row["revoked"]) is not bool
                or type(row["issuedAt"]) not in (float, int)
                or not math.isfinite(row["issuedAt"])
                or row["issuedAt"] > now
            ):
                raise ContinuityDenied("invalid registry record")
            if legacy:
                if (
                    type(row["expiresAt"]) not in (float, int)
                    or not math.isfinite(row["expiresAt"])
                    or not 0 < row["expiresAt"] - row["issuedAt"] <= 30 * 86400
                ):
                    raise ContinuityDenied("invalid legacy registry record")
                row.update(name="", persistent=False)
            elif (
                type(row["persistent"]) is not bool
                or not isinstance(row["name"], str)
                or len(row["name"]) > 80
                or any(ord(char) < 32 or ord(char) == 127 for char in row["name"])
                or (row["persistent"] and row["expiresAt"] is not None)
                or (
                    not row["persistent"]
                    and (
                        type(row["expiresAt"]) not in (float, int)
                        or not math.isfinite(row["expiresAt"])
                        or not 0 < row["expiresAt"] - row["issuedAt"] <= 30 * 86400
                    )
                )
            ):
                raise ContinuityDenied("invalid registry record")
            if unplaced:
                row.update(areaId=None, placementRevision=0)
            elif (
                (row["areaId"] is not None and not self._valid_area(row["areaId"]))
                or type(row["placementRevision"]) is not int
                or not 0 <= row["placementRevision"] <= _PLACEMENT_MAX
                or (row["areaId"] is not None and row["placementRevision"] == 0)
            ):
                raise ContinuityDenied("invalid placement record")
        if data["schema"] != 4:
            # Existing authority fields remain exactly as previously migrated.
            data.update(schema=4, vehicleRisk={})
        self._vehicle_validate(data["vehicleRisk"])
        return data

    def _write(self, data):
        data["highWater"] = max(data["highWater"], self._now())
        temporary = self.path.with_name(self.path.name + "." + secrets.token_hex(12))
        try:
            fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "w") as stream:
                json.dump(data, stream, allow_nan=False, separators=(",", ":"))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
            directory = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            temporary.unlink(missing_ok=True)

    @staticmethod
    def vehicle_device_key(config_entry_id: str, device_id: str) -> str:
        if any(
            not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value)
            for value in (config_entry_id, device_id)
        ):
            raise ContinuityDenied("invalid vehicle identity")
        # Stable across controller, policy, token and boot changes. No VIN stored.
        return hashlib.sha256(
            json.dumps([config_entry_id, device_id], separators=(",", ":")).encode()
        ).hexdigest()

    @staticmethod
    def _vehicle_hash(value):
        return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None

    @classmethod
    def _vehicle_validate(cls, risks):
        if not isinstance(risks, dict) or len(risks) > 16:
            raise ContinuityDenied("invalid vehicle risks")
        for key, row in risks.items():
            if (
                not cls._vehicle_hash(key)
                or not isinstance(row, dict)
                or set(row) != {"revision", "unresolved", "pending"}
                or type(row["revision"]) is not int
                or not 1 <= row["revision"] <= _PLACEMENT_MAX
                or not isinstance(row["unresolved"], dict)
                or not {"access", "climate"} <= set(row["unresolved"])
                or not set(row["unresolved"])
                <= {
                    "access",
                    "climate",
                    "temperature",
                    "defrost",
                    "driverSeat",
                    "passengerSeat",
                    "trunk",
                }
            ):
                raise ContinuityDenied("invalid vehicle risk")
            for family, values in row["unresolved"].items():
                allowed = {
                    "access": {"locked", "unlocked"},
                    "climate": {"on", "off"},
                    "defrost": {"on", "off"},
                    "driverSeat": {"off", "low", "medium", "high"},
                    "passengerSeat": {"off", "low", "medium", "high"},
                    "temperature": {str(i / 2) for i in range(101)},
                    "trunk": {"actuate"},
                }[family]
                values = row["unresolved"][family]
                if (
                    not isinstance(values, list)
                    or len(values) > len(allowed)
                    or any(not isinstance(v, str) or v not in allowed for v in values)
                    or values != sorted(set(values))
                ):
                    raise ContinuityDenied("invalid vehicle unresolved directions")
            pending = row["pending"]
            if pending is not None and (
                not isinstance(pending, dict)
                or set(pending)
                not in (
                    {"nonceHash", "family", "desired", "actorHash", "proposalHash"},
                    {"nonceHash", "effects", "actorHash", "proposalHash"},
                )
                or any(
                    not cls._vehicle_hash(pending[k])
                    for k in ("nonceHash", "actorHash", "proposalHash")
                )
                or not cls._vehicle_effects_valid(cls._vehicle_pending_effects(pending))
            ):
                raise ContinuityDenied("invalid pending vehicle command")

    @staticmethod
    def _vehicle_pending_effects(pending):
        if "effects" in pending:
            return pending["effects"]
        return [[pending.get("family"), pending.get("desired")]]

    @staticmethod
    def _vehicle_effects_valid(effects):
        allowed = {
            "access": {"locked", "unlocked"},
            "climate": {"on", "off"},
            "defrost": {"on", "off"},
            "driverSeat": {"off", "low", "medium", "high"},
            "passengerSeat": {"off", "low", "medium", "high"},
            "temperature": {str(i / 2) for i in range(101)},
            "trunk": {"actuate"},
        }
        return (
            isinstance(effects, list)
            and 1 <= len(effects) <= 3
            and all(
                isinstance(e, list) and len(e) == 2 and e[0] in allowed and e[1] in allowed[e[0]]
                for e in effects
            )
            and len({tuple(e) for e in effects}) == len(effects)
        )

    @staticmethod
    def _vehicle_advance(row):
        if row["revision"] >= _PLACEMENT_MAX:
            raise ContinuityDenied("vehicle revision exhausted")
        row["revision"] += 1

    def vehicle_startup(self):
        """Runtime startup only, before HTTP mounts; sole live process ownership.

        The lifetime lock distinguishes a crashed owner from another active send.
        Keep it until all native command work has stopped. An uncertain owner stays
        blocked; normal reads never recover pending work.
        """
        if self._vehicle_owner_fd is not None:
            self._vehicle_owned()
            return
        lock = self._open()
        owner = None
        try:
            owner = os.open(
                self.path.with_suffix(".vehicle-owner.lock"),
                os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW,
                0o600,
            )
            fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
            data = self._load()
            changed = False
            for row in data["vehicleRisk"].values():
                pending = row["pending"]
                if pending is not None:
                    for family, desired in self._vehicle_pending_effects(pending):
                        values = row["unresolved"].setdefault(family, [])
                        row["unresolved"][family] = sorted(set(values) | {desired})
                    row["pending"] = None
                    self._vehicle_advance(row)
                    changed = True
            if changed:
                self._write(data)
            self._vehicle_owner_fd = owner
            self._vehicle_owner_pid = os.getpid()
            owner = None
        finally:
            if owner is not None:
                os.close(owner)
            os.close(lock)

    def vehicle_stop(self):
        """Runtime shutdown only after in-flight native work has stopped."""
        owner = getattr(self, "_vehicle_owner_fd", None)
        if owner is not None:
            self._vehicle_owner_fd = None
            self._vehicle_owner_pid = None
            os.close(owner)

    def _vehicle_owned(self):
        if self._vehicle_owner_fd is None or self._vehicle_owner_pid != os.getpid():
            raise ContinuityDenied("vehicle runtime owner unavailable")

    def vehicle_risk(self, device_key: str) -> dict:
        self._vehicle_owned()
        if not self._vehicle_hash(device_key):
            raise ContinuityDenied("invalid vehicle key")
        lock = self._open()
        try:
            row = self._load()["vehicleRisk"].get(device_key)
            if row is None:
                return {
                    "revision": 0,
                    "unresolved": {"access": [], "climate": []},
                    "pending": False,
                }
            return {
                "revision": row["revision"],
                "unresolved": {
                    family: list(values) for family, values in row["unresolved"].items()
                },
                "pending": row["pending"] is not None,
            }
        finally:
            os.close(lock)

    def reserve_vehicle(
        self,
        device_key: str,
        *,
        expected_revision: int,
        family: str,
        desired: str,
        actor_hash: str,
        proposal_hash: str,
        acknowledge_prior_unresolved: bool = False,
    ) -> dict:
        self._vehicle_owned()
        if (
            not self._vehicle_hash(device_key)
            or not self._vehicle_hash(actor_hash)
            or not self._vehicle_hash(proposal_hash)
            or type(expected_revision) is not int
            or not 0 <= expected_revision < _PLACEMENT_MAX
            or family not in ("access", "climate")
            or desired not in ({"locked", "unlocked"} if family == "access" else {"on", "off"})
            or type(acknowledge_prior_unresolved) is not bool
        ):
            raise ContinuityDenied("invalid vehicle reservation")
        lock = self._open()
        try:
            data = self._load()
            risks = data["vehicleRisk"]
            row = risks.get(device_key)
            if row is None:
                if len(risks) >= 16 or expected_revision != 0:
                    raise ContinuityDenied("vehicle risk capacity or revision")
                row = {"revision": 0, "unresolved": {"access": [], "climate": []}, "pending": None}
                risks[device_key] = row
            if row["revision"] != expected_revision or row["pending"] is not None:
                raise ContinuityDenied("stale or active vehicle reservation")
            opposite = bool(set(row["unresolved"][family]) - {desired})
            if acknowledge_prior_unresolved is not opposite:
                raise ContinuityDenied("vehicle risk acknowledgement differs")
            pending = {
                "nonceHash": secrets.token_hex(32),
                "family": family,
                "desired": desired,
                "actorHash": actor_hash,
                "proposalHash": proposal_hash,
            }
            row["pending"] = pending
            self._vehicle_advance(row)
            self._write(data)  # Durable before any native effect; failure grants nothing.
            return {"deviceKey": device_key, "revision": row["revision"], **pending}
        finally:
            os.close(lock)

    def reserve_vehicle_effects(
        self,
        device_key,
        *,
        expected_revision,
        effects,
        actor_hash,
        proposal_hash,
        acknowledge_prior_unresolved=False,
    ):
        self._vehicle_owned()
        if (
            not self._vehicle_hash(device_key)
            or not self._vehicle_hash(actor_hash)
            or not self._vehicle_hash(proposal_hash)
            or type(expected_revision) is not int
            or not 0 <= expected_revision < _PLACEMENT_MAX
            or not self._vehicle_effects_valid(effects)
            or type(acknowledge_prior_unresolved) is not bool
        ):
            raise ContinuityDenied("invalid vehicle reservation")
        lock = self._open()
        try:
            data = self._load()
            risks = data["vehicleRisk"]
            row = risks.get(device_key)
            if row is None:
                if len(risks) >= 16 or expected_revision != 0:
                    raise ContinuityDenied("vehicle risk capacity or revision")
                row = {"revision": 0, "unresolved": {"access": [], "climate": []}, "pending": None}
                risks[device_key] = row
            if row["revision"] != expected_revision or row["pending"] is not None:
                raise ContinuityDenied("stale or active vehicle reservation")
            opposite = any(
                set(row["unresolved"].get(family, [])) - {desired}
                or (family == "trunk" and row["unresolved"].get(family))
                for family, desired in effects
            )
            opposite = bool(opposite)
            if acknowledge_prior_unresolved is not opposite:
                raise ContinuityDenied("vehicle risk acknowledgement differs")
            pending = {
                "nonceHash": secrets.token_hex(32),
                "effects": [list(e) for e in effects],
                "actorHash": actor_hash,
                "proposalHash": proposal_hash,
            }
            row["pending"] = pending
            self._vehicle_advance(row)
            self._write(data)
            return {"deviceKey": device_key, "revision": row["revision"], **pending}
        finally:
            os.close(lock)

    def settle_vehicle(self, reservation: dict, outcome: str) -> None:
        """ACK frees concurrency, but cannot erase possible late physical effects."""
        self._vehicle_owned()
        if (
            not isinstance(reservation, dict)
            or set(reservation)
            not in (
                {
                    "deviceKey",
                    "revision",
                    "nonceHash",
                    "family",
                    "desired",
                    "actorHash",
                    "proposalHash",
                },
                {"deviceKey", "revision", "nonceHash", "effects", "actorHash", "proposalHash"},
            )
            or not self._vehicle_hash(reservation["deviceKey"])
            or type(reservation["revision"]) is not int
            or not 1 <= reservation["revision"] <= _PLACEMENT_MAX
            or any(
                not self._vehicle_hash(reservation[k])
                for k in ("nonceHash", "actorHash", "proposalHash")
            )
            or not self._vehicle_effects_valid(self._vehicle_pending_effects(reservation))
            or outcome not in ("accepted", "unknown", "no_effect")
        ):
            raise ContinuityDenied("invalid vehicle settlement")
        lock = self._open()
        try:
            data = self._load()
            row = data["vehicleRisk"].get(reservation["deviceKey"])
            expected = {k: v for k, v in reservation.items() if k not in {"deviceKey", "revision"}}
            if (
                row is None
                or row["revision"] != reservation["revision"]
                or row["pending"] != expected
            ):
                raise ContinuityDenied("stale vehicle settlement")
            if outcome != "no_effect":
                for family, desired in self._vehicle_pending_effects(expected):
                    row["unresolved"][family] = sorted(
                        set(row["unresolved"].get(family, [])) | {desired}
                    )
            row["pending"] = None
            self._vehicle_advance(row)
            self._write(data)  # Failure leaves conservative pending/unknown at caller.
        finally:
            os.close(lock)

    def initialize(self):
        """Create the exact empty generation before acknowledging admin provisioning."""
        fd = self._open()
        try:
            if not self.path.exists():
                self._write(self._load(create=True))
            else:
                self._load()  # Existing generation/corruption must fail closed.
        finally:
            os.close(fd)

    def enroll(self, room: str, pin: str, *, name: str = "", persistent: bool = False):
        if (
            not isinstance(room, str)
            or not 1 <= len(room) <= 160
            or not isinstance(pin, str)
            or re.fullmatch(r"[a-f0-9]{64}", pin) is None
            or not isinstance(name, str)
            or len(name) > 80
            or any(ord(char) < 32 or ord(char) == 127 for char in name)
            or type(persistent) is not bool
        ):
            raise ContinuityDenied("invalid enrollment")
        fd = self._open()
        try:
            data = self._load(create=True)
            now = self._now()
            # Reclaim only authorities already dead before this successful commit.
            # A changed pin is not revocation and cannot silently evict a profile.
            data["records"] = {
                identity: row
                for identity, row in data["records"].items()
                if not row["revoked"]
                and (
                    row["persistent"]
                    or now < min(row["expiresAt"], row["issuedAt"] + self.days * 86400)
                )
            }
            if len(data["records"]) >= 256:
                raise ContinuityDenied("registry full")
            if sum(row["room"] == room for row in data["records"].values()) >= 2:
                raise ContinuityDenied("room enrollment full")
            identity, secret = secrets.token_hex(16), secrets.token_urlsafe(32)
            token = identity + "." + secret
            data["records"][identity] = {
                "digest": hashlib.sha256(token.encode()).hexdigest(),
                "room": room,
                "pin": pin,
                "issuedAt": now,
                "expiresAt": None if persistent else now + self.days * 86400,
                "revoked": False,
                "name": name,
                "persistent": persistent,
                "areaId": None,
                "placementRevision": 0,
            }
            self._write(data)
            return token, identity, data["records"][identity]["expiresAt"]
        finally:
            os.close(fd)

    def validate(self, token: str, room: str, pin: str, *, renew=False):
        if not isinstance(token, str) or not re.fullmatch(
            r"[a-f0-9]{32}\.[A-Za-z0-9_-]{43}", token
        ):
            raise ContinuityDenied("invalid controller")
        identity = token.split(".", 1)[0]
        fd = self._open()
        try:
            data = self._load()
            row = self._row(data, identity, room, pin)
            if not secrets.compare_digest(
                row["digest"], hashlib.sha256(token.encode()).hexdigest()
            ):
                raise ContinuityDenied("invalid controller")
            if renew:
                self._write(data)
            return identity, row["expiresAt"]
        finally:
            os.close(fd)

    def _row(self, data, identity, room, pin):
        row = data["records"].get(identity)
        now = self._now()
        if (
            row is None
            or row["revoked"]
            or row["room"] != room
            or row["pin"] != pin
            or now < row["issuedAt"]
            or (
                not row["persistent"]
                and now >= min(row["expiresAt"], row["issuedAt"] + self.days * 86400)
            )
        ):
            raise ContinuityDenied("controller unavailable")
        return row

    def current(self, identity: str, room: str, pin: str):
        fd = self._open()
        try:
            self._row(self._load(), identity, room, pin)
            return True
        finally:
            os.close(fd)

    @staticmethod
    def _valid_area(value):
        return isinstance(value, str) and _AREA_ID.fullmatch(value) is not None

    @staticmethod
    def _placement_scope(identity, room, pin):
        if (
            not isinstance(identity, str)
            or re.fullmatch(r"[a-f0-9]{32}", identity) is None
            or not isinstance(room, str)
            or not 1 <= len(room) <= 160
            or not isinstance(pin, str)
            or re.fullmatch(r"[a-f0-9]{64}", pin) is None
        ):
            raise ContinuityDenied("invalid placement scope")

    def _placement(self, identity, row):
        # The digest is a secret high-entropy record owner, not a browser identifier.
        # Legacy reads derive the same opaque binding without mutating the file.
        binding = hashlib.sha256(
            json.dumps(
                [
                    "podview.placement.v1",
                    self.generation,
                    identity,
                    row["digest"],
                    row["room"],
                    row["pin"],
                    row["placementRevision"],
                    row["areaId"],
                ],
                separators=(",", ":"),
            ).encode()
        ).hexdigest()
        return {
            "areaId": row["areaId"],
            "placementRevision": row["placementRevision"],
            "bindingId": binding,
        }

    def placement(self, identity: str, room: str, pin: str) -> dict:
        """Internal current-profile read; identity/pin and record secrets stay server-side."""
        self._placement_scope(identity, room, pin)
        fd = self._open()
        try:
            return self._placement(identity, self._row(self._load(), identity, room, pin))
        finally:
            os.close(fd)

    def set_placement(
        self,
        identity: str,
        room: str,
        pin: str,
        *,
        area_id: str | None,
        expected_revision: int,
        valid_area_ids: list[str] | tuple[str, ...] | set[str] | frozenset[str],
        administrator: bool,
    ) -> dict:
        """Trusted admin adapter only: fresh HA registry IDs, then atomic compare-and-set.

        The adapter authenticates the current HA administrator and revalidates its
        HA area snapshot after awaits. Neither a browser label nor placement grants
        command authority. None explicitly clears; an identical setting is a no-op.
        """
        self._placement_scope(identity, room, pin)
        if (
            administrator is not True
            or type(expected_revision) is not int
            or not 0 <= expected_revision <= _PLACEMENT_MAX
            or (area_id is not None and not self._valid_area(area_id))
            or type(valid_area_ids) not in (list, tuple, set, frozenset)
            or len(valid_area_ids) > 1024
            or any(not self._valid_area(area) for area in valid_area_ids)
            or (area_id is not None and area_id not in valid_area_ids)
        ):
            raise ContinuityDenied("invalid administrator placement")
        fd = self._open()
        try:
            data = self._load()
            row = self._row(data, identity, room, pin)
            if row["placementRevision"] != expected_revision:
                raise ContinuityDenied("stale placement revision")
            if row["areaId"] != area_id:
                if expected_revision == _PLACEMENT_MAX:
                    raise ContinuityDenied("placement revision exhausted")
                row.update(areaId=area_id, placementRevision=expected_revision + 1)
                self._write(data)
            return self._placement(identity, row)
        finally:
            os.close(fd)

    def revoke(self, identity: str | None = None, *, room: str | None = None):
        """Administrator file tool only; not mounted as a viewer HTTP endpoint."""
        if identity is not None and (
            not isinstance(identity, str) or re.fullmatch(r"[a-f0-9]{32}", identity) is None
        ):
            raise ContinuityDenied("invalid controller identity")
        if room is not None and (not isinstance(room, str) or not 1 <= len(room) <= 160):
            raise ContinuityDenied("invalid room")
        fd = self._open()
        try:
            data = self._load()
            if identity is not None and (
                identity not in data["records"]
                or (room is not None and data["records"][identity]["room"] != room)
            ):
                raise ContinuityDenied("controller unavailable")
            for key, row in data["records"].items():
                if (identity is None or identity == key) and (room is None or room == row["room"]):
                    row["revoked"] = True
            self._write(data)
        finally:
            os.close(fd)

    def list_enrollments(self, room: str, pin: str) -> list[dict]:
        """Trusted administrator listing; browser secrets and owner pins stay private."""
        if (
            not isinstance(room, str)
            or not 1 <= len(room) <= 160
            or not isinstance(pin, str)
            or re.fullmatch(r"[a-f0-9]{64}", pin) is None
        ):
            raise ContinuityDenied("invalid listing scope")
        fd = self._open()
        try:
            data = self._load()
            now = self._now()
            return [
                {
                    "id": identity,
                    "name": row["name"],
                    "room": room,
                    "persistent": row["persistent"],
                    "expiresAt": row["expiresAt"],
                    "areaId": row["areaId"],
                    "placementRevision": row["placementRevision"],
                    "status": "revoked"
                    if row["revoked"]
                    else "stale"
                    if row["pin"] != pin
                    else "expired"
                    if not row["persistent"]
                    and now >= min(row["expiresAt"], row["issuedAt"] + self.days * 86400)
                    else "active",
                }
                for identity, row in data["records"].items()
                if row["room"] == room
            ]
        finally:
            os.close(fd)
