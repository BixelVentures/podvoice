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

    def account_playlist_offer(self, **change):
        self.context = {**CONTEXT, "query": "account_playlists:collection"}
        data = {
            "ok": True,
            "schema": "podconnect.user_playlists.v1",
            "config_entry_id": "account",
            "owner_epoch": "epoch",
            "source": "spotify_web_api",
            "coverage": "first_page",
            "limit": 20,
            "returned_count": 1,
            "source_has_more": True,
            "playlists": [{"uri": "spotify:playlist:" + "P" * 22, "name": "My playlist"}],
        }
        self.identifier = self.broker.register(
            self.context, data, self.binding, kind="account_playlists"
        )
        self.assertIsNotNone(self.identifier)
        self.playlist_data = data
        self.playlist_controls = {**CONTROLS, "actions": ["play_context"]}
        candidate = self.broker.candidate_set(self.identifier)
        self.playlist_candidate = candidate
        return self.offer(
            observed_controls=self.playlist_controls,
            candidate_ids=[candidate["items"][0]["id"]],
            **change,
        )

    async def execute_account_playlist(self, offer, **change):
        async def fresh():
            return copy.deepcopy(self.playlist_controls)

        args = {"fresh_controls": fresh, **change}
        return await self.execute(offer, **args)

    async def test_account_playlist_read_then_fresh_context_offer_sends_exact_uri_once(self):
        offer = self.account_playlist_offer()
        self.assertEqual(self.playlist_candidate["sourceKind"], "account_playlists")
        self.assertNotIn("uri", str(offer))
        self.assertEqual(offer["options"][0]["artist"], "Playliste")
        self.assertEqual(self.broker.tasks[offer["taskId"]]["action"], "play_context")
        result = await self.execute_account_playlist(offer)
        self.assertEqual(result["outcome"], "accepted")
        self.assertEqual(self.sent[0][1], self.playlist_data["playlists"][0]["uri"])
        self.assertEqual(await self.execute_account_playlist(offer), result)
        self.assertEqual(
            (await self.execute_account_playlist(offer, request_id="another"))["outcome"],
            "rejected",
        )
        self.assertEqual(len(self.sent), 1)

    def test_account_playlist_catalogue_is_read_only_and_binds_native_epoch(self):
        self.account_playlist_offer()
        self.broker.tasks.clear()
        candidate = self.broker.candidate_set(self.identifier)
        self.assertEqual(self.broker.tasks, {})
        self.assertEqual(self.sent, [])
        self.assertEqual(self.broker.receipts, {})
        self.assertEqual(len(candidate["items"]), 1)
        for controls in (
            {**self.playlist_controls, "owner_epoch": "PC-restarted"},
            {**self.playlist_controls, "actions": ["play_track"]},
            {**self.playlist_controls, "config_entry_id": "another-account"},
            {**self.playlist_controls, "target": {"kind": "spotify_device", "target_id": "other"}},
        ):
            with self.subTest(controls=controls):
                self.assertIsNone(
                    self.offer(
                        candidate_ids=[candidate["items"][0]["id"]], observed_controls=controls
                    )
                )

    def test_account_playlist_registration_rejects_wrong_catalogue_provenance(self):
        self.account_playlist_offer()
        for field, value in (
            ("schema", "podconnect.top_tracks.v1"),
            ("config_entry_id", "another-account"),
            ("source", "synthetic"),
            ("owner_epoch", ""),
            ("coverage", "complete"),
            ("limit", 50),
            ("returned_count", 2),
            ("source_has_more", 1),
            ("playlists", [{"uri": URI, "name": "track"}]),
            ("playlists", [{"uri": "spotify:playlist:" + "P" * 22}]),
            ("playlists", []),
        ):
            with self.subTest(field=field, value=value):
                data = {**self.playlist_data, field: value}
                self.assertIsNone(
                    self.broker.register(self.context, data, self.binding, kind="account_playlists")
                )

    async def test_account_playlist_stale_context_and_native_destination_never_send(self):
        for field, value in (
            ("bootId", "other-boot"),
            ("roomId", "other-room"),
            ("sessionId", "other-session"),
            ("turnId", "other-turn"),
            ("taskId", "other-task"),
            ("inputRevision", 2),
            ("revision", 3),
            ("configEntryId", "other-account"),
            ("query", "top:collection"),
        ):
            offer = self.account_playlist_offer()
            with self.subTest(field=field):
                changed = {**self.context, field: value}
                self.assertIsNone(
                    self.offer(
                        context=changed,
                        observed_controls=self.playlist_controls,
                        candidate_ids=[self.playlist_candidate["items"][0]["id"]],
                    )
                )
                self.assertEqual(
                    (await self.execute_account_playlist(offer, context=changed))["outcome"],
                    "rejected",
                )
        for field, value in (
            ("owner_epoch", "PC-restarted"),
            ("config_entry_id", "other-account"),
            ("room_id", "other-native-room"),
            ("homepod_id", "other-homepod"),
            ("target", {"kind": "spotify_device", "target_id": "other-device"}),
            ("actions", ["play_track"]),
        ):
            offer = self.account_playlist_offer()

            async def fresh(field=field, value=value):
                return {**self.playlist_controls, field: value}

            with self.subTest(field=field):
                self.assertEqual(
                    (await self.execute_account_playlist(offer, fresh_controls=fresh))["outcome"],
                    "rejected",
                )
        self.assertEqual(self.sent, [])

    async def test_account_playlist_wait_cancel_and_replacement_cannot_dispatch(self):
        for mode in ("cancel", "new_catalogue", "new_context", "new_owner"):
            offer = self.account_playlist_offer()
            entered, release = asyncio.Event(), asyncio.Event()

            async def held(entered=entered, release=release):
                entered.set()
                await release.wait()
                return copy.deepcopy(self.playlist_controls)

            pending = asyncio.create_task(self.execute_account_playlist(offer, fresh_controls=held))
            await asyncio.wait_for(entered.wait(), timeout=2)
            if mode == "cancel":
                pending.cancel()
            elif mode == "new_catalogue":
                self.broker.register(
                    self.context, self.playlist_data, self.binding, kind="account_playlists"
                )
            elif mode == "new_context":
                self.context["inputRevision"] += 1
            else:
                self.live = False
            release.set()
            with self.subTest(mode=mode):
                self.assertEqual((await pending)["outcome"], "rejected")
                self.assertEqual(self.sent, [])
            self.live = True

    async def test_account_playlist_unknown_never_replays(self):
        offer = self.account_playlist_offer()
        calls = []

        async def unknown(_controls, uri, _ceiling, current):
            self.assertTrue(current())
            self.assertEqual(uri, self.playlist_data["playlists"][0]["uri"])
            calls.append(uri)
            raise TimeoutError

        result = await self.execute_account_playlist(offer, send_once=unknown)
        self.assertEqual(result["outcome"], "unknown")
        self.assertEqual(await self.execute_account_playlist(offer), result)
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.sent, [])


if __name__ == "__main__":
    unittest.main()
