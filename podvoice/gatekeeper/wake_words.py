"""The ordinary wake models shipped by the paired Voice PE firmware."""

WAKE_WORDS = ("okay_nabu", "hey_jarvis", "hey_mycroft", "hey_chat")
DEFAULT_WAKE_WORD = "okay_nabu"


def load_wake_word(value: object) -> str:
    """Preserve valid legacy choices; corrupt disk/options values use the default."""
    return value if isinstance(value, str) and value in WAKE_WORDS else DEFAULT_WAKE_WORD
