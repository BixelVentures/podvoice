"""Token-bound announcement stop; reuses the existing Voice PE speaker graph."""

import hashlib
import json

import esphome.codegen as cg
import esphome.config_validation as cv
import esphome.final_validate as fv
from esphome import automation
from esphome.components import micro_wake_word, speaker, switch, text_sensor
from esphome.components.mixer.speaker import MixerSpeaker, SourceSpeaker
from esphome.components.resampler.speaker import ResamplerSpeaker
from esphome.components.speaker_source.media_player import SpeakerSourceMediaPlayer
from esphome.const import CONF_ID
from esphome.const import __version__ as esphome_version

DEPENDENCIES = ["micro_wake_word"]
ns = cg.esphome_ns.namespace("podvoice_reply")
PodVoiceReply = ns.class_("PodVoiceReply", cg.Component)
_FIELDS = {
    "player": SpeakerSourceMediaPlayer,
    "resampler": ResamplerSpeaker,
    "source": SourceSpeaker,
    "mixer": MixerSpeaker,
    "output": speaker.Speaker,
    "status": text_sensor.TextSensor,
    "stop_model": micro_wake_word.WakeWordModel,
    "detector": micro_wake_word.MicroWakeWord,
    "context_status": text_sensor.TextSensor,
    "mute_switch": switch.Switch,
}
CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(PodVoiceReply),
        **{cv.Required(key): cv.use_id(typ) for key, typ in _FIELDS.items()},
        cv.Optional("on_timer_stop"): automation.validate_automation(single=True),
    }
).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
    for key in _FIELDS:
        cg.add(getattr(var, "set_" + key)(await cg.get_variable(config[key])))
    if "on_timer_stop" in config:
        await automation.build_automation(var.get_timer_stop_trigger(), [], config["on_timer_stop"])


def _validate_artifacts(config):
    # These observers inspect exact upstream queue/task semantics. A newer runtime
    # must be reviewed and physically validated before changing this pin.
    if esphome_version != "2026.6.2":
        raise cv.Invalid("PodVoice local stop requires the reviewed ESPHome 2026.6.2 toolchain")
    models = fv.full_config.get()["micro_wake_word"]["models"]
    chosen = next(m for m in models if str(m[CONF_ID]) == str(config["stop_model"]))
    manifest, data = micro_wake_word._model_config_to_manifest_data(chosen["model"])
    manifest_sha = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
    if (
        manifest_sha != "6348d65678dd21f7ea87897bafcfbaab554fdd611056f421d53bec268b556dd4"
        or hashlib.sha256(data).hexdigest()
        != ("b5a18c4ad681a89950dfade31011e1631bdcb333e93c84519a1a63ff4f071146")
    ):
        raise cv.Invalid("Stop model differs from the reviewed manifest/model SHA-256")
    if "probability_cutoff" in chosen or "sliding_window_size" in chosen:
        raise cv.Invalid("Stop sensitivity overrides require a separate measured candidate")
    return config


FINAL_VALIDATE_SCHEMA = _validate_artifacts
