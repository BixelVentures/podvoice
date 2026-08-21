"""Stable user-facing classification for live Realtime readiness."""

from gatekeeper.thin import _provider_failure_reason


def test_provider_billing_and_rate_limits_are_not_connection_errors():
    assert (
        _provider_failure_reason("insufficient_quota: billing hard limit reached")
        == "OpenAI-kontoen mangler saldo eller kredit"
    )
    assert (
        _provider_failure_reason("429 rate_limit_exceeded")
        == "OpenAI er midlertidigt ratebegrænset"
    )


def test_provider_auth_timeout_and_network_have_distinct_statuses():
    assert _provider_failure_reason("invalid_api_key 401") == "OpenAI API-nøglen blev afvist"
    assert _provider_failure_reason("connect timeout") == "OpenAI svarede ikke inden timeout"
    assert _provider_failure_reason(TimeoutError()) == "OpenAI svarede ikke inden timeout"
    assert _provider_failure_reason("socket closed") == "Realtime-forbindelsen blev afbrudt"
