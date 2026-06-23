"""Provider factory — picks the voice brain (Gemini Live or OpenAI Realtime).

Both backends satisfy voice.VoiceSession, so callers (console, room pipeline)
get the same interface regardless of provider.
"""

from __future__ import annotations

from .config import Config
from .voice import VoiceSession


def make_session(
    cfg: Config,
    *,
    provider: str | None = None,
    model: str | None = None,
    tool_declarations: list[dict] | None = None,
) -> VoiceSession:
    p = (provider or cfg.provider or "gemini").lower()
    if p == "openai":
        from .openai_realtime import OpenAIRealtimeSession

        return OpenAIRealtimeSession(
            api_key=cfg.openai_api_key,
            model=model or cfg.openai_model,
            voice=cfg.openai_voice or "marin",
            instructions=cfg.system_prompt,
            tool_declarations=tool_declarations,
            turn=cfg.openai_turn,
            threshold=cfg.openai_threshold,
            prefix_ms=cfg.openai_prefix_ms,
            silence_ms=cfg.openai_silence_ms,
            eagerness=cfg.openai_eagerness,
            noise=cfg.openai_noise,
            web_search=cfg.web_search,
        )
    from .gemini import GeminiLiveSession, build_config

    return GeminiLiveSession(
        api_key=cfg.gemini_api_key,
        model=model or cfg.gemini_model,
        config=build_config(cfg, tool_declarations),
    )
