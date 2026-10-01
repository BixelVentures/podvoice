"""Closure-only currency never weakens ordinary tool/approval currency."""

import pytest
from test_openai_live import call, created, provider, stage, submit_terminal_results, terminal

from gatekeeper.openai_live import LiveProtocolError


@pytest.mark.parametrize("source", ["transcript", "typed"])
async def test_end_receipt_ignores_raw_tv_but_typed_input_revokes(source):
    session, sdk, _ = provider()
    session.tool_declarations.append(
        {
            "name": "end_conversation",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        }
    )
    await session.connect()
    try:
        await stage(session, [call(name="end_conversation", arguments="{}")])
        await session.admit_tool_batch("r1", 1)
        receipt = session.create_closure_receipt("r1", generation=1)
        await submit_terminal_results(session)
        if source == "typed":
            session.note_local_input()
        else:
            await session._handle(
                {
                    "type": "session.input_transcript.delta",
                    "delta": "TV fragment",
                    "start_ms": 0,
                    "end_ms": 1,
                },
                1,
            )
        await session._handle(created("r2"), 1)
        await session._handle(terminal("r2"), 1)
        if source == "typed":
            assert receipt.cancelled() and not session.closure_receipt_current(receipt)
        else:
            assert receipt.result() is True
            assert session.closure_receipt_current(receipt)
            assert not session.terminal_receipt_current(receipt)
        assert sdk.session.close.await_count == 0
    finally:
        await session.close()


async def test_ordinary_tool_cannot_claim_closure_only_receipt():
    session, _, _ = provider()
    await session.connect()
    try:
        await stage(session)
        await session.admit_tool_batch("r1", 1)
        with pytest.raises(LiveProtocolError, match="exclusive_end"):
            session.create_closure_receipt("r1", generation=1)
    finally:
        await session.close()
