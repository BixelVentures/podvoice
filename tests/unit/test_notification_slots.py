"""Exercise exact ESPHome wake functions against ESP-IDF's real pthread_join body."""

import hashlib
import importlib.util
import json
import re
import runpy
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[2]
FIXTURE = ROOT / "tests/firmware/notification_slots"
SPEC = importlib.util.spec_from_file_location(
    "notification_slots", ROOT / "esphome/components/podvoice_reply/notification_slots.py"
)
PATCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PATCH)


def generated_project(tmp_path):
    core = tmp_path / "src/esphome/core"
    shutil.copytree(FIXTURE / "core", core)
    (core / "version.h").write_text('#define ESPHOME_VERSION "2026.6.2"\n')
    return core


def function(source, name):
    definition = re.search(r"^[^\n/]*\b" + re.escape(name) + r"\([^;]*?\)\s*\{", source, re.M)
    assert definition, name
    start = definition.start()
    brace = source.index("{", start)
    end, depth = brace + 1, 1
    while depth:
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return source[start:end]


def test_patch_exact_sources_idempotence_and_build_hook(tmp_path):
    core = generated_project(tmp_path)
    provenance = json.loads((FIXTURE / "provenance.json").read_text())
    assert provenance["core_sha256"] == PATCH.ORIGINAL
    assert (
        hashlib.sha256((FIXTURE / "pthread_join.c").read_bytes()).hexdigest()
        == provenance["pthread_extract_sha256"]
    )
    PATCH.patch_generated_core(tmp_path)
    first = {name: (core / name).read_bytes() for name in PATCH.ORIGINAL}
    assert {name: hashlib.sha256(data).hexdigest() for name, data in first.items()} == PATCH.PATCHED
    PATCH.patch_generated_core(tmp_path)
    assert first == {name: (core / name).read_bytes() for name in PATCH.ORIGINAL}
    codegen = (ROOT / "esphome/components/podvoice_reply/__init__.py").read_text()
    assert '"pre", "podvoice_notification_slots.py"' in codegen
    assert (
        'CONFIG_FREERTOS_TASK_NOTIFICATION_ARRAY_ENTRIES: "2"'
        in (ROOT / "esphome/podvoice.yaml").read_text()
    )


@pytest.mark.parametrize("drift", ["version", "source", "symlink", "hardlink"])
def test_patch_rejects_unreviewed_tree_before_any_write(tmp_path, drift):
    core = generated_project(tmp_path)
    if drift == "version":
        (core / "version.h").write_text('#define ESPHOME_VERSION "2099.1.0"\n')
    elif drift == "source":
        with (core / "wake/wake_freertos.h").open("a") as output:
            output.write("\n// changed upstream\n")
    elif drift == "symlink":
        target = core / "wake/wake_freertos.h"
        target.unlink()
        target.symlink_to(FIXTURE / "core/wake/wake_freertos.h")
    else:
        (tmp_path / "shared_header.h").hardlink_to(core / "wake/wake_freertos.h")
    original_main = (core / "main_task.h").read_bytes()
    with pytest.raises(RuntimeError):
        PATCH.patch_generated_core(tmp_path)
    assert (core / "main_task.h").read_bytes() == original_main


def test_scons_entrypoint_patches_generated_project(tmp_path):
    core = generated_project(tmp_path)
    imported = []
    runpy.run_path(
        SPEC.origin,
        init_globals={"Import": imported.append, "env": {"PROJECT_DIR": str(tmp_path)}},
    )
    assert imported == ["env"]
    assert {
        name: hashlib.sha256((core / name).read_bytes()).hexdigest() for name in PATCH.ORIGINAL
    } == PATCH.PATCHED


@pytest.mark.parametrize("entries", [1, 2])
def test_actual_header_requires_kernel_notification_array(tmp_path, entries):
    generated_project(tmp_path)
    PATCH.patch_generated_core(tmp_path)
    headers = tmp_path / "freertos"
    headers.mkdir()
    (headers / "FreeRTOS.h").write_text(
        f"#define configTASK_NOTIFICATION_ARRAY_ENTRIES {entries}\n"
        "#include <stddef.h>\ntypedef void* TaskHandle_t;\ntypedef int BaseType_t;\n"
    )
    (headers / "task.h").write_text(
        "void xTaskNotifyGiveIndexed(TaskHandle_t, int);\n"
        "void vTaskNotifyGiveIndexedFromISR(TaskHandle_t, int, BaseType_t*);\n"
    )
    cpp = tmp_path / "guard.cpp"
    cpp.write_text('#define USE_ESP32\n#include "src/esphome/core/main_task.h"\n')
    result = subprocess.run(
        ["c++", "-fsyntax-only", "-I", str(tmp_path), str(cpp)], capture_output=True, text=True
    )
    if entries == 1:
        assert result.returncode != 0
        assert "PodVoice requires at least two FreeRTOS task notification entries" in result.stderr
    else:
        assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("isolated", [False, True], ids=["shipped106_collision", "isolated_wake"])
def test_actual_join_ignores_only_separate_wake_slot(tmp_path, isolated):
    core = generated_project(tmp_path)
    if isolated:
        PATCH.patch_generated_core(tmp_path)
    sources = {name: (core / name).read_text() for name in PATCH.ORIGINAL}
    wake_functions = "\n".join(
        [
            function(sources["main_task.h"], "esphome_main_task_notify"),
            function(sources["main_task.h"], "esphome_main_task_notify_from_isr"),
            function(sources["lwip_fast_select.c"], "esphome_socket_event_callback"),
            function(sources["wake/wake_freertos.h"], "wakeable_delay"),
        ]
    )
    # Only rename the public POSIX symbols to avoid the host libc's pthread ABI.
    # The actual IDF function's locking, wait and destruction order is untouched.
    join = (
        (FIXTURE / "pthread_join.c").read_text().replace("pthread_t thread", "ProbeThread thread")
    )
    join = join.replace("int pthread_join(", "int probe_join(")
    cpp = tmp_path / "notification_slots.cpp"
    cpp.write_text(
        r"""
#include <cassert>
#include <cstdint>
#include <cerrno>
#include <cstdio>
using TaskHandle_t = void*;
using ProbeThread = void*;
using BaseType_t = int;
struct esp_pthread_t {
  bool detached=false;
  TaskHandle_t join_task=nullptr;
  int state=1;
  void* retval=nullptr;
  bool select_linked=true;
  bool deleted=false;
};
constexpr int PTHREAD_TASK_STATE_RUN=1, portMAX_DELAY=-1, pdTRUE=1;
#define ESP_LOGV(...)
#define ESPHOME_ALWAYS_INLINE
#define ESPHOME_MAIN_TASK_NOTIFICATION_INDEX 1
#define pdMS_TO_TICKS(x) (x)
int main_task, s_threads_lock, premature_frees=0, real_exits=0;
TaskHandle_t esphome_main_task_handle=&main_task;
esp_pthread_t* joining=nullptr;
bool pending[2]{};
int mode=0;
bool concurrent=false;
void _lock_acquire(int*){}
void _lock_release(int*){}
TaskHandle_t xTaskGetCurrentTaskHandle(){return &main_task;}
TaskHandle_t pthread_find_handle(ProbeThread thread){return thread;}
esp_pthread_t* pthread_find(TaskHandle_t){return nullptr;}
void pthread_delete(esp_pthread_t*){}
void pthread_internal_local_storage_destructor_callback(TaskHandle_t task){
  auto* child=static_cast<esp_pthread_t*>(task);
  if(child->select_linked) ++premature_frees;
}
void vTaskDelete(TaskHandle_t task){static_cast<esp_pthread_t*>(task)->deleted=true;}
void xTaskNotifyGiveIndexed(TaskHandle_t task,int index){assert(task==&main_task);pending[index]=true;}
void xTaskNotifyGive(TaskHandle_t task){xTaskNotifyGiveIndexed(task,0);}
void vTaskNotifyGiveIndexedFromISR(TaskHandle_t task,int index,BaseType_t*){xTaskNotifyGiveIndexed(task,index);}
void vTaskNotifyGiveFromISR(TaskHandle_t task,BaseType_t* flag){vTaskNotifyGiveIndexedFromISR(task,0,flag);}
int ulTaskNotifyTakeIndexed(int index,int,int){int result=pending[index];pending[index]=false;return result;}
int ulTaskNotifyTake(int clear,int ticks){return ulTaskNotifyTakeIndexed(0,clear,ticks);}
void yield(){}
struct netconn {};
enum netconn_evt { NETCONN_EVT_RCVPLUS=1 };
using u16_t=uint16_t;
void s_original_callback(netconn*,netconn_evt,u16_t){}
WAKE_FUNCTIONS
void unrelated_wake(){
  if(mode==0) esphome_main_task_notify();
  else if(mode==1){BaseType_t flag=0;esphome_main_task_notify_from_isr(&flag);}
  else esphome_socket_event_callback(nullptr,NETCONN_EVT_RCVPLUS,1);
}
int xTaskNotifyWait(uint32_t,uint32_t,void*,int){
  assert(joining && joining->select_linked);
  if(concurrent) unrelated_wake();
  // Deterministic scheduler: the unrelated wake arrives before child exit.
  // A correct channel waits for real exit. Default-slot collision skips it.
  if(!pending[0]){
    joining->select_linked=false; // actual select returns and unlinks first
    ++real_exits;
    pending[0]=true; // pthread_exit notifies the joining task on slot zero
  }
  pending[0]=false;
  return 1;
}
JOIN_FUNCTION
int main(){
  for(mode=0;mode<3;++mode){
    for(int timing=0;timing<2;++timing){
      concurrent=timing==1;
      pending[0]=pending[1]=false;
      premature_frees=real_exits=0;
      // Both joins in DecoderSource::stop are vulnerable independently.
      for(int worker=0;worker<2;++worker){
        esp_pthread_t child;
        joining=&child;
        if(!concurrent) unrelated_wake();
        assert(probe_join(&child,nullptr)==0 && child.deleted);
        if(ISOLATED){
          assert(!child.select_linked && real_exits==worker+1 && premature_frees==0);
          assert(pending[1]); // join must not consume the loop's wake
        }else{
          assert(child.select_linked && premature_frees==worker+1 && real_exits==0);
        }
      }
      // After safe joins the loop consumes its own wake, leaving join-slot zero.
      if(ISOLATED){
        pending[0]=true;
        wakeable_delay(1);
        assert(!pending[1] && pending[0]);
      }
    }
  }
  std::printf("%s: task/ISR/TCP, pending/concurrent, reader+decoder verified\n",
              ISOLATED ? "SAFE" : "PREMATURE_DELETE_REPRODUCED");
}
""".replace("WAKE_FUNCTIONS", wake_functions)
        .replace("JOIN_FUNCTION", join)
        .replace("ISOLATED", str(int(isolated)))
    )
    binary = tmp_path / "notification_slots"
    subprocess.run([shutil.which("c++"), "-std=c++17", str(cpp), "-o", str(binary)], check=True)
    result = subprocess.run([str(binary)], check=True, text=True, capture_output=True)
    assert ("SAFE" if isolated else "PREMATURE_DELETE_REPRODUCED") in result.stdout
