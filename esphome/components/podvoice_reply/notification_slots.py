"""Isolate ESPHome wake notifications from ESP-IDF pthread_join's slot zero.

PlatformIO pre-build hook: patch only this generated project's ESPHome 2026.6.2
copies. Never modify the installed toolchain. Exact before/after hashes make
upstream changes fail closed, including a partially changed source tree.
"""

import hashlib
from pathlib import Path

VERSION = "2026.6.2"
SLOT = "ESPHOME_MAIN_TASK_NOTIFICATION_INDEX"
SLOT_DECLARATION = """// Slot 0 belongs to ESP-IDF pthread_join; wake signals must never satisfy a join.
#define ESPHOME_MAIN_TASK_NOTIFICATION_INDEX 1
#if configTASK_NOTIFICATION_ARRAY_ENTRIES <= ESPHOME_MAIN_TASK_NOTIFICATION_INDEX
#error "PodVoice requires at least two FreeRTOS task notification entries"
#endif

"""
# Relative to src/esphome/core. These are the complete upstream file hashes.
ORIGINAL = {
    "main_task.h": "b1a5d25c6e15c0cd02d7611415c9e8a90d816bc331331dfc1b305eff9f42c131",
    "lwip_fast_select.c": "e4c7071f6d00b679faeca96725b64d5ba3e593edf851d95cc0e8af57368d86c4",
    "wake/wake_freertos.h": "de5d713ebdf52dba565d736e930516602afed4550fed817c8ef6fe935d74829b",
}
PATCHED = {
    "main_task.h": "89c51414a7be3df46ad08280caad9879911ed393cfb367827b0ff0c1771ba51e",
    "lwip_fast_select.c": "419620460a58794a3d21304c3ee64ad7c05c42cbaafb2c0ba92d6bfe2b76a7fc",
    "wake/wake_freertos.h": "eae3001bb629eea45a0255bacf8f732fc69c3f7d00d9aa34bf80be3c9a04198a",
}
REPLACEMENTS = {
    "main_task.h": (
        (
            "extern TaskHandle_t esphome_main_task_handle;",
            SLOT_DECLARATION + "extern TaskHandle_t esphome_main_task_handle;",
        ),
        ("xTaskNotifyGive(task);", f"xTaskNotifyGiveIndexed(task, {SLOT});"),
        (
            "vTaskNotifyGiveFromISR(task, px_higher_priority_task_woken);",
            f"vTaskNotifyGiveIndexedFromISR(task, {SLOT}, px_higher_priority_task_woken);",
        ),
    ),
    "lwip_fast_select.c": (("xTaskNotifyGive(task);", f"xTaskNotifyGiveIndexed(task, {SLOT});"),),
    "wake/wake_freertos.h": (
        (
            "ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(ms));",
            f"ulTaskNotifyTakeIndexed({SLOT}, pdTRUE, pdMS_TO_TICKS(ms));",
        ),
    ),
}


def patched_source(name: str, source: str) -> str:
    for old, new in REPLACEMENTS[name]:
        if source.count(old) != 1:
            raise RuntimeError(f"Unexpected ESPHome notification source: {name}")
        source = source.replace(old, new)
    return source


def patch_generated_core(project: Path) -> None:
    core = project / "src/esphome/core"
    if f'#define ESPHOME_VERSION "{VERSION}"' not in (core / "version.h").read_text():
        raise RuntimeError("PodVoice notification patch requires ESPHome 2026.6.2")
    pending = []
    # Validate every input before writing any output. Idempotence accepts only
    # this patch's exact result, never an arbitrary pre-existing indexed variant.
    for name, original_hash in ORIGINAL.items():
        path = core / name
        if (
            path.is_symlink()
            or path.stat().st_nlink != 1
            or not path.resolve().is_relative_to(project.resolve())
        ):
            raise RuntimeError(f"Refusing to patch outside generated project: {path}")
        source = path.read_text()
        digest = hashlib.sha256(source.encode()).hexdigest()
        if digest == PATCHED[name]:
            continue
        if digest != original_hash:
            raise RuntimeError(f"Unreviewed ESPHome notification source: {name} ({digest})")
        changed = patched_source(name, source)
        if hashlib.sha256(changed.encode()).hexdigest() != PATCHED[name]:
            raise RuntimeError(f"Unexpected notification patch output: {name}")
        pending.append((path, changed))
    for path, changed in pending:
        path.write_text(changed)


if "Import" in globals():  # SCons supplies this hook; importing in tests is read-only.
    globals()["Import"]("env")
    patch_generated_core(Path(globals()["env"]["PROJECT_DIR"]))
