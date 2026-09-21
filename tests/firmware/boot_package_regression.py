"""Regression for hardware boot lost by ESPHome package type replacement.

Run with the pinned ESPHome 2026.6.2 firmware environment, outside Documents.
No device access or compilation; dummy secrets remain in a temporary directory.
"""

import shutil
import tempfile
from pathlib import Path

from esphome import yaml_util
from esphome.components.packages import do_packages_pass, merge_packages
from esphome.core import CORE


def main():
    root = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix="podvoice-boot-contract-") as directory:
        work = Path(directory)
        for name in ("voice-pe-podvoice-base.yaml", "podvoice.yaml", "podvoice-live-alpha.yaml"):
            shutil.copyfile(root / "esphome" / name, work / name)
        (work / "secrets.yaml").write_text(
            'podvoice_api_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="\n'
        )
        base = yaml_util.load_yaml(work / "voice-pe-podvoice-base.yaml")
        expected = base["esphome"]["on_boot"]
        assert isinstance(expected, list), "Hardware boot must be a list before package merge"
        assert len(expected) == 1 and expected[0]["priority"] == 375
        assert {"switch.turn_on": "internal_speaker_amp"} in expected[0]["then"]
        for name in ("podvoice.yaml", "podvoice-live-alpha.yaml"):
            CORE.reset()
            CORE.config_path = str(work / name)
            config = yaml_util.load_yaml(work / name)
            merged = merge_packages(do_packages_pass(config))
            boots = merged["esphome"]["on_boot"]
            assert len(boots) == 2, (name, "Expected hardware and capture boot")
            assert boots[0] == expected[0], (name, "Hardware boot changed or disappeared")
            assert boots[1]["priority"] == -100
            assert (
                boots[1]["then"][0]["text_sensor.template.publish"]["id"]
                == "podvoice_capture_status"
            )
            # Reproduce the exact field failure, proving the oracle detects it.
            # Separate negative control uses the actual merge helper with the original mixed shapes.
            from esphome.config_helpers import merge_config

            lost = merge_config({"on_boot": expected[0]}, {"on_boot": [boots[1]]})
            assert lost["on_boot"] == [boots[1]] and expected[0] not in lost["on_boot"]
            print(
                f"PASS {name}: original hardware boot + capture init exactly once; old defect reproduced"
            )


if __name__ == "__main__":
    main()
