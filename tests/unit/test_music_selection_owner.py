"""Causal owner and replay checks for the proposed music selection boundary."""

import asyncio
import copy
import time
import unittest

from podvoice.gatekeeper.podview_music_selection import MusicSelection

URI = "spotify:track:" + "A" * 22
CONTEXT = {
    "schema": "podview.music-search-context.v1",
    "bootId": "boot",
    "roomId": "r0",
    "sessionId": "session",
    "turnId": "turn",
    "taskId": "task",
    "inputRevision": 1,
    "revision": 2,
    "revisionScope": "answer_task",
    "configEntryId": "account",
    "source": "spotify_web_api",
    "query": "jazz",
}
DATA = {"tracks": [{"uri": URI, "name": "Song", "artist": "Artist"}]}
CONTROLS = {
    "ok": True,
    "status": "ready",
    "schema": "podconnect.room_content_controls.v1",
    "config_entry_id": "account",
    "owner_epoch": "epoch",
    "actions": ["play_track"],
    "target": {"kind": "spotify_device", "target_id": "device"},
    "room_id": "native-room",
    "homepod_id": "homepod-id",
    "physical_result_verified": False,
    "start_offer": {
        "start_volume_percent": 35,
        "binding_id": "binding-1",
        "native_incarnation": "incarnation-1",
        "policy_revision": "b" * 64,
    },
    "valid_until": 9999999999,
}


class MusicSelectionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.broker = MusicSelection()
        self.context = dict(CONTEXT)
        self.binding = ("owner", 1)
        self.authority = ("grant", 1)
        self.live = True
        self.sent = []
        self.identifier = self.broker.register(self.context, DATA, self.binding)

    def offer(self, **change):
        args = dict(
            identifier=self.identifier,
            context=self.context,
            owner_binding=self.binding,
            account="account",
            target="device",
            native_binding=("native-room", "homepod-id"),
            observed_controls=CONTROLS,
            approved_max_volume=40,
            authority=self.authority,
            current=lambda: self.live,
        )
        args.update(change)
        return self.broker.offer(**args)

    async def execute(self, offer, **change):
        async def fresh():
            return dict(CONTROLS)

        async def send(controls, uri, _max_volume, current):
            self.assertTrue(current())
            self.sent.append((controls, uri))
            return {"outcome": "accepted", "accepted_selected_content": True}

        args = dict(
            task_id=offer["taskId"],
            revision=offer["revision"],
            option_id=offer["options"][0]["id"],
            request_id="one",
            confirmed_volume=offer["startVolumePercent"],
            context=self.context,
            owner_binding=self.binding,
            authority=self.authority,
            current=lambda: self.live,
            fresh_controls=fresh,
            send_once=send,
        )
        args.update(change)
        return await self.broker.execute(**args)

    async def test_one_opaque_option_maps_to_server_source_once(self):
        offer = self.offer()
        self.assertEqual(offer["candidateSetId"], self.identifier)
        self.assertNotIn("uri", str(offer))
        result = await self.execute(offer)
        self.assertEqual(result["outcome"], "accepted")
        self.assertEqual(self.sent[0][1], URI)
        self.assertEqual(await self.execute(offer), result)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual((await self.execute(offer, request_id="two"))["outcome"], "rejected")

    async def test_stale_task_owner_binding_and_authority_never_send(self):
        for change in (
            dict(revision=3),
            dict(context={**CONTEXT, "taskId": "other"}),
            dict(owner_binding=("owner", 2)),
            dict(authority=("other", 1)),
        ):
            offer = self.offer()
            self.assertEqual((await self.execute(offer, **change))["outcome"], "rejected")
        self.assertEqual(self.sent, [])

    async def test_unknown_volume_and_raised_volume_block_new_play(self):
        self.assertIsNone(
            self.offer(observed_controls={k: v for k, v in CONTROLS.items() if k != "start_offer"})
        )
        self.assertIsNone(
            self.offer(
                observed_controls={
                    **CONTROLS,
                    "start_offer": {**CONTROLS["start_offer"], "start_volume_percent": 34},
                }
            )
        )
        offer = self.offer()

        async def high():
            return {
                **CONTROLS,
                "start_offer": {**CONTROLS["start_offer"], "start_volume_percent": 36},
            }

        self.assertEqual((await self.execute(offer, fresh_controls=high))["outcome"], "rejected")
        self.assertEqual(self.sent, [])
        other = self.offer()
        self.assertEqual((await self.execute(other, confirmed_volume=90))["outcome"], "rejected")

    async def test_provider_unknown_is_not_replayed(self):
        offer = self.offer()
        calls = []

        async def fail(_controls, _uri, _max_volume, _current):
            calls.append(1)
            raise TimeoutError

        result = await self.execute(offer, send_once=fail)
        self.assertEqual(result["outcome"], "unknown")
        self.assertEqual((await self.execute(offer))["outcome"], "unknown")
        self.assertEqual(calls, [1])
        self.assertEqual(self.sent, [])

    async def test_new_offer_during_fresh_read_revokes_old_send(self):
        offer = self.offer()
        entered, release = asyncio.Event(), asyncio.Event()

        async def held():
            entered.set()
            await release.wait()
            return dict(CONTROLS)

        pending = asyncio.create_task(self.execute(offer, fresh_controls=held))
        await asyncio.wait_for(entered.wait(), timeout=2)
        replacement = self.offer()
        self.assertNotEqual(replacement["taskId"], offer["taskId"])
        release.set()
        self.assertEqual((await pending)["outcome"], "rejected")
        self.assertEqual(self.sent, [])

    async def test_inflight_same_request_returns_exact_unknown_and_pins_fingerprint(self):
        offer = self.offer()
        entered, release = asyncio.Event(), asyncio.Event()

        async def held_send(controls, uri, ceiling, current):
            self.assertTrue(current())
            self.sent.append(uri)
            entered.set()
            await release.wait()
            return {"outcome": "accepted", "accepted_selected_content": True}

        pending = asyncio.create_task(self.execute(offer, send_once=held_send))
        await asyncio.wait_for(entered.wait(), timeout=2)
        try:
            expected = copy.deepcopy(self.broker.receipts[(offer["taskId"], "one")][1])
            self.assertEqual(expected["outcome"], "unknown")
            self.assertEqual(await self.execute(offer, send_once=held_send), expected)
            changed = await self.execute(offer, confirmed_volume=36, send_once=held_send)
            self.assertEqual(changed["outcome"], "rejected")
            self.assertEqual(len(self.sent), 1)
        finally:
            release.set()
            settled = await pending
        self.assertEqual(settled["outcome"], "accepted")
        self.assertEqual(await self.execute(offer, send_once=held_send), settled)
        self.assertEqual(len(self.sent), 1)

    async def test_new_source_during_fresh_read_revokes_old_send(self):
        offer = self.offer()
        entered, release = asyncio.Event(), asyncio.Event()

        async def held():
            entered.set()
            await release.wait()
            return dict(CONTROLS)

        pending = asyncio.create_task(self.execute(offer, fresh_controls=held))
        await asyncio.wait_for(entered.wait(), timeout=2)
        replacement = self.broker.register(self.context, DATA, self.binding)
        self.assertNotEqual(replacement, self.identifier)
        release.set()
        self.assertEqual((await pending)["outcome"], "rejected")
        self.assertEqual(self.sent, [])

    def test_changed_source_set_and_missing_voice_owner_fail_closed(self):
        self.assertIsNone(self.offer(context={**CONTEXT, "query": "other"}))
        self.assertIsNone(self.broker.register({**CONTEXT, "sessionId": None}, DATA, self.binding))
        self.assertIsNone(self.offer())

    def test_crossed_account_epoch_discards_source(self):
        self.assertIsNone(self.offer(account="other-account"))

    async def test_fixed_start_volume_ignores_generic_spotify_observation(self):
        controls = copy.deepcopy(CONTROLS)
        controls["observedVolumePercent"] = 10
        offer = self.offer(observed_controls=controls)
        self.assertEqual(offer["startVolumePercent"], 35)

        async def fresh():
            return copy.deepcopy(controls)

        self.assertEqual((await self.execute(offer, fresh_controls=fresh))["outcome"], "accepted")

    async def test_generic_observed_volume_does_not_change_fixed_start_volume(self):
        controls = copy.deepcopy(CONTROLS)
        controls["observedVolumePercent"] = 39
        offer = self.offer(observed_controls=controls)
        self.assertEqual(offer["startVolumePercent"], 35)

        async def fresh():
            return copy.deepcopy(controls)

        self.assertEqual((await self.execute(offer, fresh_controls=fresh))["outcome"], "accepted")

    async def test_missing_or_changed_native_proof_fails_closed(self):
        missing = {k: v for k, v in CONTROLS.items() if k != "start_offer"}
        self.assertIsNone(self.offer(observed_controls=missing))
        for field, value in (
            ("binding_id", "replacement"),
            ("native_incarnation", "replacement"),
            ("policy_revision", "c" * 64),
        ):
            offer = self.offer()
            changed = copy.deepcopy(CONTROLS)
            changed["start_offer"][field] = value

            async def fresh(value=changed):
                return value

            self.assertEqual(
                (await self.execute(offer, fresh_controls=fresh))["outcome"], "rejected"
            )
        self.assertEqual(self.sent, [])

    async def test_expired_task_never_refreshes_or_sends(self):
        offer = self.offer()
        self.broker.tasks[offer["taskId"]]["deadline"] = time.monotonic() - 1
        self.assertEqual((await self.execute(offer))["outcome"], "rejected")
        self.assertEqual(self.sent, [])

    async def test_observation_expiry_cannot_be_renewed_by_fresh_read(self):
        controls = copy.deepcopy(CONTROLS)
        controls["valid_until"] = time.time() - 1
        offer = self.offer(observed_controls=controls)
        self.assertIsNone(offer)


if __name__ == "__main__":
    unittest.main()
