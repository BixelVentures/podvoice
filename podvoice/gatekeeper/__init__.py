"""PodVoice gatekeeper — standalone voice-AI gatekeeper for a PodConnect home.

A custom-firmware HA Voice PE streams raw audio to this service; it runs a
full-duplex Gemini Live conversation and ducks the room's music through
PodConnect's Attention API while the conversation is live.

See PLAN.md for the full architecture.
"""

__version__ = "0.41.0"
