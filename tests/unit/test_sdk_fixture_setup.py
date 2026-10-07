"""Cold offline SDK setup mirrors the shipped pre-wake dependency boundary."""

import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path


def test_cold_real_sdk_preparation_precedes_bounded_fixture_connect(tmp_path):
    root = Path(__file__).resolve().parents[2]
    program = textwrap.dedent("""
        import asyncio, json, time
        from gatekeeper import openai_live
        from unit.test_openai_live import diagnostic_wire_provider
        from test_live_socket_cleanup import test_finalized_actual_sdk_closes_owned_tcp_without_peer_shutdown

        real_prepare = openai_live._load_live_sdk
        order = []
        def cold_prepare():
            order.append('prepare_started')
            # Reproduce an import cost beyond the unchanged 2s handshake clock.
            # This is pure fixture setup, not provider delay or product tuning.
            time.sleep(2.05)
            factory = real_prepare()
            order.append('prepare_finished')
            return factory
        openai_live._load_live_sdk = cold_prepare

        async def main():
            session, sdk, rows = diagnostic_wire_provider()
            assert session.timeout_s == 2
            assert order == ['prepare_started', 'prepare_finished']
            order.append('wire_connect')
            try:
                await session.connect()
                await session.append_instructions('Offline fixture boundary check.')
                instruction = [e for e in sdk.wire if e['type'] == 'session.instructions.append']
                assert len(instruction) == 1 and instruction[0]['event_id']
                assert instruction[0]['content'] == 'Offline fixture boundary check.'
                assert not session._append_waiters
            finally:
                await session.close()
            assert sdk.released
            assert sum(e['type'] == 'session.start' for e in sdk.wire) == 1
            assert sum(e['type'] == 'session.close' for e in sdk.wire) == 1
            # Exercise the actual TCP peer, real SDK terminal parsing, owned
            # transport close and delayed old-generation cleanup assertions.
            order.append('socket_fixture_setup')
            await test_finalized_actual_sdk_closes_owned_tcp_without_peer_shutdown('handshake_stall')
            assert order == ['prepare_started', 'prepare_finished', 'wire_connect',
                             'socket_fixture_setup', 'prepare_started', 'prepare_finished']
            print(json.dumps({'order': order, 'deadline_s': 2, 'wire_ack': True,
                              'actual_tcp_cleanup': True, 'provider_calls': False}))
        asyncio.run(main())
    """)
    env = dict(os.environ)
    env["PYTHONPYCACHEPREFIX"] = str(tmp_path / "cold-pycache")
    env["PYTHONPATH"] = os.pathsep.join(
        map(str, [root / "podvoice", root / "tests", root / "tests/integration"])
    )
    result = subprocess.run(
        [sys.executable, "-c", program],
        cwd=root,
        env=env,
        capture_output=True,
        text=True,
        timeout=45,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    proof = json.loads(result.stdout.strip().splitlines()[-1])
    assert proof["deadline_s"] == 2 and proof["wire_ack"] and proof["actual_tcp_cleanup"]
    assert proof["provider_calls"] is False
