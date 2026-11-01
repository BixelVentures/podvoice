import asyncio
import copy
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from podvoice.gatekeeper import podview_room_move as move

POLICY = "f" * 64


def source(room="r1", homepod="43"):
    return {
        "ok": True,
        "schema": "podconnect.room_move_controls.v1",
        "config_entry_id": "account",
        "owner_epoch": "owner",
        "poll_sequence": 3,
        "next_command_sequence": 4,
        "observation": {
            "status": "fresh",
            "observed_at": datetime.now(UTC).isoformat(),
            "age_ms": 0,
            "max_age_ms": 15000,
            "source": "spotify_web_api",
        },
        "target": {"kind": "spotify_device", "target_id": "same-engine"},
        "room_id": room,
        "homepod_id": homepod,
        "actions": ["move_existing_session"],
        "status": "ready",
        "move_offer": {
            "schema": "podconnect.room_output_move_offer.v1",
            "offer_id": "a" * 32,
            "binding_id": "b" * 64,
            "native_incarnation": "c" * 32,
            "policy_revision": POLICY,
            "session_volume_percent": 27,
            "expires_after_ms": 5000,
        },
        "physical_result_verified": False,
    }


def prep(body, state="staged"):
    value = {
        k: body[k]
        for k in [
            "config_entry_id",
            "owner_epoch",
            "request_id",
            "command_sequence",
            "action",
            "room_id",
            "homepod_id",
        ]
    }
    value.update(
        ok=state == "staged",
        schema="podconnect.room_move_preparation.v1",
        target={"kind": "spotify_device", "target_id": body["target_id"]},
        state=state,
        retry_allowed=False,
        physical_result_verified=False,
    )
    return value


def receipt(body, outcome="accepted"):
    value = {
        k: body[k]
        for k in [
            "config_entry_id",
            "owner_epoch",
            "request_id",
            "command_sequence",
            "action",
            "room_id",
            "homepod_id",
        ]
    }
    value.update(
        ok=outcome == "accepted",
        schema="podconnect.command.v1",
        target={"kind": "spotify_device", "target_id": body["target_id"]},
        outcome=outcome,
        provider_request_accepted=False,
        retry_allowed=False,
        physical_result_verified=False,
        accepted_room_move=outcome == "accepted",
        move_operation_id="d" * 32 if outcome != "rejected" else None,
        session_volume_percent=27 if outcome != "rejected" else None,
    )
    return value


def build(monkeypatch, handler=None, **options):
    current = {"value": True, "binding": ("owner",)}
    client = SimpleNamespace(is_closed=False)
    tools = SimpleNamespace(
        _client=client,
        _token="inert-token",
        _discovery=SimpleNamespace(podconnect_services=set(move._SERVICES)),
        podview_music_binding=lambda: current["binding"],
    )
    facade = move.RoomMoveFacade(
        tools,
        policy_revision=POLICY,
        **options,
    )
    calls = []

    async def read(captured_client, token, service, body):
        calls.append((service, copy.deepcopy(body), captured_client, token))
        if handler is not None:
            result = await handler(service, body, current, facade)
            if result is not None:
                return result
        if service == "get_room_move_controls":
            return source(body["room_id"], body["homepod_id"])
        if service == "prepare_room_move_playback":
            return prep(body)
        if service == "move_room_playback":
            return receipt(body)
        return {}

    monkeypatch.setattr(facade, "_read", read)
    return facade, current, calls


def test_default_off_without_explicit_reviewed_private_policy_and_budgets():
    tools = SimpleNamespace()
    assert not move.RoomMoveFacade(tools).available


@pytest.mark.parametrize(
    "tools",
    [
        None,
        SimpleNamespace(),
        SimpleNamespace(_discovery=SimpleNamespace(podconnect_services=None)),
        SimpleNamespace(_discovery=SimpleNamespace(podconnect_services=set(move._SERVICES))),
    ],
)
def test_partial_tool_adapter_is_unavailable_without_raising(tools):
    assert not move.RoomMoveFacade(tools, policy_revision=POLICY).available


def test_actual_split_facade_preserves_same_engine_other_alias_and_manual_27(
    monkeypatch,
):
    async def run():
        facade, current, calls = build(monkeypatch)
        offer = await facade.setup("account", "same-engine", "r1", "43", lambda: current["value"])
        result = await facade.move(offer, lambda: current["value"])
        assert result["accepted_room_move"] is True and result["session_volume_percent"] == 27
        assert [c[0] for c in calls] == [
            "get_room_move_controls",
            "prepare_room_move_playback",
            "move_room_playback",
        ]
        assert calls[1][1] == calls[2][1] and len(calls[1][1]) == 12
        assert (
            calls[2][1]["target_id"] == "same-engine"
            and calls[2][1]["room_id"] == "r1"
            and calls[2][1]["args"] == {}
        )
        assert not (await facade.move(offer, lambda: True))["ok"]
        assert len(calls) == 3

    asyncio.run(run())


@pytest.mark.parametrize(
    "change",
    [
        "account",
        "engine",
        "room",
        "homepod",
        "policy",
        "volume_bool",
        "offer_extra",
        "stale",
        "sequence_bool",
        "wrongaction",
        "fake_source",
    ],
)
def test_read_offer_cannot_invent_or_substitute_owner(change):
    value = source()
    if change == "account":
        value["config_entry_id"] = "foreign"
    if change == "engine":
        value["target"]["target_id"] = "Tesla"
    if change == "room":
        value["room_id"] = "other"
    if change == "homepod":
        value["homepod_id"] = "99"
    if change == "policy":
        value["move_offer"]["policy_revision"] = "0" * 64
    if change == "volume_bool":
        value["move_offer"]["session_volume_percent"] = True
    if change == "offer_extra":
        value["move_offer"]["authorized"] = True
    if change == "stale":
        value["observation"]["age_ms"] = 15001
    if change == "sequence_bool":
        value["next_command_sequence"] = True
    if change == "wrongaction":
        value["actions"] = ["play_track"]
    if change == "fake_source":
        value["observation"]["source"] = "browser"
    with pytest.raises(ValueError):
        move.controls(value, "account", "same-engine", "r1", "43", POLICY, move.time.monotonic())


@pytest.mark.parametrize(
    "change", ["grant", "binding", "malformed", "unknown", "rejected", "expired"]
)
def test_preparation_cannot_bypass_actual_final_pv_guard(monkeypatch, change):
    async def handler(service, body, current, _facade):
        if service == "prepare_room_move_playback":
            if change == "grant":
                current["value"] = False
            if change == "binding":
                current["binding"] = ("replaced",)
            if change == "malformed":
                return {"ok": True, "accepted_room_move": True}
            if change in {"unknown", "rejected", "expired"}:
                return prep(body, change)
        return None

    async def run():
        facade, current, calls = build(monkeypatch, handler)
        offer = await facade.setup("account", "same-engine", "r1", "43", lambda: current["value"])
        result = await facade.move(offer, lambda: current["value"])
        assert not result["ok"] and result["retryAllowed"] is False
        assert "move_room_playback" not in [c[0] for c in calls]
        assert calls[-1][0] == "cancel_room_move_preparation" and len(calls[-1][1]) == 6
        assert not (await facade.move(offer, lambda: True))["ok"]

    asyncio.run(run())


@pytest.mark.parametrize(
    "change",
    [
        "volume35",
        "wrong_destination",
        "fake_native",
        "boolean_sequence",
        "unknown",
        "malformed",
    ],
)
def test_completion_never_credits_partial_foreign_or_unknown_as_success(monkeypatch, change):
    async def handler(service, body, _current, _facade):
        if service != "move_room_playback":
            return None
        value = receipt(body)
        if change == "volume35":
            value["session_volume_percent"] = 35
        if change == "wrong_destination":
            value["room_id"] = "r0"
        if change == "fake_native":
            value["accepted_native"] = True
        if change == "boolean_sequence":
            value["command_sequence"] = True
        if change == "unknown":
            value = receipt(body, "unknown")
        if change == "malformed":
            value = {"accepted_local": True}
        return value

    async def run():
        facade, current, calls = build(monkeypatch, handler)
        offer = await facade.setup("account", "same-engine", "r1", "43", lambda: current["value"])
        result = await facade.move(offer, lambda: current["value"])
        assert (
            not result["ok"]
            and not result.get("accepted_room_move")
            and result["outcome"] == "unknown"
        )
        assert len([c for c in calls if c[0] == "move_room_playback"]) == 1

    asyncio.run(run())


@pytest.mark.parametrize("phase", ["prepare_room_move_playback", "move_room_playback"])
def test_current_loss_while_waiting_cancels_exact_old_owner_once(monkeypatch, phase):
    async def run():
        entered = asyncio.Event()

        async def handler(service, body, current, _facade):
            if service == phase:
                entered.set()
                await asyncio.Event().wait()

        facade, current, calls = build(monkeypatch, handler)
        oldclient = facade.tools._client
        offer = await facade.setup("account", "same-engine", "r1", "43", lambda: current["value"])
        task = asyncio.create_task(facade.move(offer, lambda: current["value"]))
        await entered.wait()
        current["value"] = False
        facade.tools._client = SimpleNamespace(is_closed=False)
        result = await task
        assert not result["ok"]
        cancels = [c for c in calls if c[0] == "cancel_room_move_preparation"]
        assert len(cancels) == 1 and cancels[0][2] is oldclient
        if phase == "prepare_room_move_playback":
            assert not any(c[0] == "move_room_playback" for c in calls)
        else:
            assert result["outcome"] == "unknown"

    asyncio.run(run())


@pytest.mark.parametrize("completion", [False, True])
@pytest.mark.parametrize("phase", ["prepare_room_move_playback", "move_room_playback"])
def test_cancelled_caller_never_replays_and_joins_exact_cleanup(monkeypatch, completion, phase):
    async def run():
        entered = asyncio.Event()

        async def handler(service, _body, _current, _facade):
            if service == phase:
                entered.set()
                await asyncio.Event().wait()

        facade, current, calls = build(monkeypatch, handler)
        offer = await facade.setup("account", "same-engine", "r1", "43", lambda: current["value"])
        task = asyncio.create_task(
            facade.move(
                offer,
                lambda: current["value"],
                receipt_current=(lambda: current["value"]) if completion else None,
            )
        )
        await entered.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert len([c for c in calls if c[0] == "cancel_room_move_preparation"]) == 1
        assert not (await facade.move(offer, lambda: True))["ok"]

    asyncio.run(run())


@pytest.mark.parametrize("change", ["expired", "grant", "nan", "destination"])
def test_server_offer_preflight_denies_before_any_staging(monkeypatch, change):
    async def run():
        facade, current, calls = build(monkeypatch)
        offer = await facade.setup("account", "same-engine", "r1", "43", lambda: current["value"])
        if change == "expired":
            object.__setattr__(offer, "deadline", 0)
        if change == "grant":
            current["value"] = False
        if change == "nan":
            offer.wire["move_offer"]["session_volume_percent"] = float("nan")
        if change == "destination":
            offer.wire["room_id"] = "other"
        assert not (await facade.move(offer, lambda: current["value"]))["ok"]
        assert len(calls) == 1

    asyncio.run(run())


def test_same_canonical_sequence_cannot_be_replayed_through_new_setup(monkeypatch):
    async def run():
        facade, current, calls = build(monkeypatch)

        def guard():
            return current["value"]

        first = await facade.setup("account", "same-engine", "r1", "43", guard)
        assert (await facade.move(first, guard))["accepted_room_move"]
        second = await facade.setup("account", "same-engine", "r0", "42", guard)
        assert second is not None
        assert not (await facade.move(second, guard))["ok"]
        assert len([c for c in calls if c[0] == "prepare_room_move_playback"]) == 1

    asyncio.run(run())


def test_source_may_advance_canonical_poll_and_sequence_without_changing_destination(
    monkeypatch,
):
    async def handler(service, body, _current, _facade):
        if service == "get_room_move_controls":
            value = source(body["room_id"], body["homepod_id"])
            value["poll_sequence"] = 7
            value["next_command_sequence"] = 8
            return value
        return None

    async def run():
        facade, current, calls = build(monkeypatch, handler)
        offer = await facade.setup("account", "same-engine", "r1", "43", lambda: current["value"])
        result = await facade.move(offer, lambda: current["value"])
        assert (
            result["ok"]
            and calls[1][1]["command_sequence"] == 8
            and calls[1][1]["expected_poll_sequence"] == 7
        )

    asyncio.run(run())


def test_actual_service_transport_is_closed_no_redirects_and_bounded(monkeypatch):
    import json

    requests = []

    class Response:
        status_code = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def aiter_bytes(self, size):
            yield json.dumps({"service_response": source()}).encode()

    class Client:
        def stream(self, method, url, **kwargs):
            requests.append((method, url, kwargs))
            return Response()

    facade = move.RoomMoveFacade(SimpleNamespace())
    value = asyncio.run(
        facade._read(
            Client(),
            "inert-token",
            "get_room_move_controls",
            {"config_entry_id": "account"},
        )
    )
    assert value["schema"] == "podconnect.room_move_controls.v1"
    assert len(requests) == 1 and requests[0][0] == "POST"
    assert requests[0][1].endswith("/services/podconnect/get_room_move_controls?return_response")
    assert requests[0][2]["follow_redirects"] is False
    assert requests[0][2]["timeout"] == 8


def test_cancellation_during_cleanup_does_not_send_second_cancel(monkeypatch):
    async def run():
        entered = asyncio.Event()

        async def handler(service, body, _current, _facade):
            if service == "prepare_room_move_playback":
                return prep(body, "unknown")
            if service == "cancel_room_move_preparation":
                entered.set()
                await asyncio.Event().wait()
            return None

        facade, current, calls = build(monkeypatch, handler)
        offer = await facade.setup("account", "same-engine", "r1", "43", lambda: current["value"])
        task = asyncio.create_task(facade.move(offer, lambda: current["value"]))
        await entered.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert len([c for c in calls if c[0] == "cancel_room_move_preparation"]) == 1

    asyncio.run(run())


def test_queued_read_rechecks_actual_grant_before_transport_starts(monkeypatch):
    async def run():
        facade, _current, calls = build(monkeypatch)

        async def transport(*_args):
            calls.append("dispatched")
            return {}

        monkeypatch.setattr(facade, "_read", transport)
        checks = 0

        def guard():
            nonlocal checks
            checks += 1
            return checks == 1

        with pytest.raises(ValueError):
            await facade._guarded_read(
                facade.tools._client,
                facade.tools._token,
                "move_room_playback",
                {},
                facade.binding(),
                guard,
                1,
            )
        assert calls == [] and checks >= 2

    asyncio.run(run())


@pytest.mark.parametrize("phase", ["pre", "prepare", "committed", "owner", "binding", "backend"])
def test_move_strict_admission_and_owned_late_completion(monkeypatch, phase):
    async def run():
        from types import SimpleNamespace

        real = move.time
        elapsed = [0]
        wall, mono = real.time(), real.monotonic()
        monkeypatch.setattr(
            move,
            "time",
            SimpleNamespace(time=lambda: wall + elapsed[0], monotonic=lambda: mono + elapsed[0]),
        )

        async def handler(service, body, current, _facade):
            if service == "prepare_room_move_playback" and phase == "prepare":
                elapsed[0] = 6
            if service == "move_room_playback":
                elapsed[0] = 6
                if phase == "owner":
                    current["value"] = False
                if phase == "binding":
                    current["binding"] = ("replacement",)
                if phase == "backend":
                    value = receipt(body)
                    value["owner_epoch"] = "foreign"
                    return value
                if phase == "committed":
                    # The committed response remains pending past a guard poll;
                    # presentation expiry must not cancel this owned read.
                    await asyncio.sleep(0.06)
            return None

        facade, current, calls = build(monkeypatch, handler)

        def strict():
            return current["value"] and elapsed[0] < 5

        def retained():
            return current["value"]

        offer = await facade.setup("account", "same-engine", "r1", "43", strict)
        if phase == "pre":
            elapsed[0] = 6
        result = await facade.move(offer, strict, receipt_current=retained)
        effects = [call[0] for call in calls if call[0] != "get_room_move_controls"]
        if phase == "committed":
            assert result["outcome"] == "accepted" and result["accepted_room_move"] is True
            assert effects == ["prepare_room_move_playback", "move_room_playback"]
        elif phase == "pre":
            assert result["outcome"] == "rejected" and effects == []
        elif phase == "prepare":
            assert result["outcome"] == "rejected"
            assert effects == ["prepare_room_move_playback", "cancel_room_move_preparation"]
        else:
            assert result["outcome"] == "unknown"
            assert effects.count("move_room_playback") == 1
        before = len(calls)
        assert (await facade.move(offer, strict, receipt_current=retained))["outcome"] == "rejected"
        assert len(calls) == before

    asyncio.run(run())
