"""PodVoice gatekeeper — standalone voice-AI gatekeeper for a PodConnect home.

A custom-firmware HA Voice PE streams raw audio to this service; it runs an
OpenAI Realtime conversation and ducks the room's music through
PodConnect's Attention API while the conversation is live.

See ``docs/INVARIANTER.md`` for the binding architecture contract.
"""

__version__ = "1.13.17"
