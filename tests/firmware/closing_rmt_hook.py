"""Compile actual vendored driver against small host hardware stubs; no ESP32 claim."""

import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DRIVER = ROOT / "esphome/components/esp32_rmt_led_strip"
COMMON = r"""
#pragma once
#include <cstdint>
#include <cassert>
#include <cstddef>
#include <cstring>
#include <optional>
#include <functional>
#include <vector>
#define ESP_IDF_VERSION_VAL(a,b,c) (((a)<<16)|((b)<<8)|(c))
#define ESP_IDF_VERSION ESP_IDF_VERSION_VAL(5,5,4)
#define IRAM_ATTR
#define HOT
#define ESP_LOGE(...)
#define ESP_LOGVV(...)
#define ESP_LOGCONFIG(...)
#define ESP_OK 0
struct portMUX_TYPE { unsigned depth=0; };
#define portMUX_INITIALIZER_UNLOCKED {}
inline unsigned critical_depth=0, isr_entries=0, main_entries=0;
inline void portENTER_CRITICAL(portMUX_TYPE *mux){assert(mux->depth==0);mux->depth++;critical_depth++;main_entries++;}
inline void portEXIT_CRITICAL(portMUX_TYPE *mux){assert(mux->depth==1);mux->depth--;critical_depth--;}
inline void portENTER_CRITICAL_ISR(portMUX_TYPE *mux){portENTER_CRITICAL(mux);isr_entries++;}
inline void portEXIT_CRITICAL_ISR(portMUX_TYPE *mux){portEXIT_CRITICAL(mux);}
inline bool test_fail_ledger=false;
using esp_err_t=int;using gpio_num_t=int;using soc_module_clk_t=int;
inline constexpr int RMT_CLK_SRC_DEFAULT=0,ESP_CLK_TREE_SRC_FREQ_PRECISION_CACHED=0;
struct rmt_symbol_word_t {uint16_t duration0=0,level0=0,duration1=0,level1=0;uint32_t val=0;};
using rmt_channel_handle_t=void*;using rmt_encoder_handle_t=void*;
struct rmt_tx_channel_config_t {int clk_src=0,resolution_hz=0,gpio_num=0,mem_block_symbols=0,trans_queue_depth=0,intr_priority=0;struct{bool invert_out=false,with_dma=false;}flags;};
struct rmt_simple_encoder_config_t {size_t (*callback)(const void*,size_t,size_t,size_t,rmt_symbol_word_t*,bool*,void*)=nullptr;void*arg=nullptr;size_t min_chunk_size=0;};
struct rmt_tx_done_event_data_t {size_t num_symbols=0;};
struct rmt_tx_event_callbacks_t {bool (*on_trans_done)(rmt_channel_handle_t,const rmt_tx_done_event_data_t*,void*)=nullptr;};
struct rmt_transmit_config_t {int reserved=0;};
inline rmt_tx_event_callbacks_t test_callbacks;inline void* test_user=nullptr;
inline int test_registered=0,test_transmits=0,test_error=0;inline uint32_t test_us=50000;
inline int esp_clk_tree_src_get_freq_hz(int,int,uint32_t*out){*out=80000000;return 0;}
inline int64_t esp_timer_get_time(){assert(critical_depth==0);return test_us;}
inline int rmt_new_tx_channel(rmt_tx_channel_config_t*,void**out){*out=(void*)1;return 0;}
inline int rmt_new_simple_encoder(rmt_simple_encoder_config_t*,void**out){*out=(void*)2;return 0;}
inline int rmt_enable(void*){return 0;}
inline int rmt_tx_register_event_callbacks(void*,const rmt_tx_event_callbacks_t*c,void*u){test_callbacks=*c;test_user=u;test_registered++;return 0;}
inline int rmt_tx_wait_all_done(void*,int){assert(critical_depth==0);return 0;} // Queue COMPLETE can precede ISR callback.
inline int rmt_transmit(void*,void*,void*,size_t,rmt_transmit_config_t*){assert(critical_depth==0);test_transmits++;return test_error;}
namespace esphome {
template<class T> using optional=std::optional<T>;
inline uint32_t micros(){return test_us;}inline void delayMicroseconds(int){}
namespace setup_priority {inline constexpr float HARDWARE=800;}
struct Color {uint8_t r=0,g=0,b=0,w=0;Color()=default;Color(uint8_t r,uint8_t g,uint8_t b,uint8_t w=0):r(r),g(g),b(b),w(w){}};
class Component {bool failed=false;public:virtual ~Component()=default;virtual void setup(){};virtual void loop(){};virtual void dump_config(){};virtual float get_setup_priority()const{return 0;}void mark_failed(){failed=true;}bool is_failed()const{return failed;}void status_set_warning(){}void status_clear_warning(){}};
template<class T>struct RAMAllocator {static constexpr int ALLOC_INTERNAL=1;explicit RAMAllocator(int){}T*allocate(size_t n){if(test_fail_ledger&&n==1)return nullptr;return new T[n];}};
namespace light {
enum class ColorMode {RGB_WHITE,WHITE,RGB};class LightState{};
struct LightTraits {void set_supported_color_modes(std::initializer_list<ColorMode>) {}};
struct ESPColorCorrection{};
struct ESPColorView {uint8_t *r,*g,*b,*w,*effect;const ESPColorCorrection*correction;uint8_t get_red_raw()const{return *r;}uint8_t get_green_raw()const{return *g;}uint8_t get_blue_raw()const{return *b;}uint8_t get_white_raw()const{return w?*w:0;}};
class AddressableLight:public Component {public:int shows=0;virtual int32_t size()const=0;virtual LightTraits get_traits(){return{};}virtual void write_state(LightState*){};virtual void clear_effect_data(){};void schedule_show(){shows++;}void mark_shown_(){};protected:virtual ESPColorView get_view_internal(int32_t)const=0;ESPColorCorrection correction_;};
}}
"""
HARNESS = r"""
#include "led_strip.h"
#include <cassert>
#include <tuple>
#include <iostream>
using namespace esphome;using namespace esphome::esp32_rmt_led_strip;
struct Driver:ESP32RMTLEDStripLightOutput {void paint(Color c){for(int i=0;i<num_leds_;++i){auto v=get_view_internal(i);*v.r=c.r;*v.g=c.g;*v.b=c.b;if(v.w)*v.w=c.w;}}};
void reset(){test_registered=test_transmits=test_error=0;test_callbacks={};test_us=50000;}
void complete(uint32_t stamp){test_us=stamp;assert(test_callbacks.on_trans_done);test_callbacks.on_trans_done(nullptr,nullptr,test_user);}
void setup(Driver&d,bool on){d.set_num_leds(12);d.set_pin(21);d.set_rgb_order(ORDER_GRB);d.set_closing_tx_observer(on);d.setup();}
int main(){
 reset();Driver off;setup(off,false);off.paint(Color(0,255,255));assert(!off.arm_closing_tx(1,Color(255,255,0)));off.write_state(nullptr);off.loop();assert(test_registered==0&&test_transmits==1);
 reset();Driver d;setup(d,true);assert(test_registered==1);std::vector<std::tuple<uint32_t,uint32_t,uint32_t>> events;
 d.set_closing_tx_callback([&](auto t,auto s,auto us){assert(critical_depth==0);events.emplace_back(t,s,us);});
 d.paint(Color(0,255,255));d.write_state(nullptr);assert(test_transmits==1);
 d.paint(Color(255,255,0));assert(d.arm_closing_tx(11,Color(255,255,0)));
 d.write_state(nullptr);assert(test_transmits==1);d.loop();assert(events.empty()); // Old COMPLETE queue, no old ISR yet.
 complete(50100);d.loop();assert(events.empty());d.write_state(nullptr);assert(test_transmits==2);d.loop();assert(events.empty());
 complete(50200);d.loop();assert(events.size()==1&&std::get<0>(events[0])==11&&std::get<1>(events[0])==2&&std::get<2>(events[0])==50200);
 d.loop();assert(events.size()==1); // Once only.
 assert(d.arm_closing_tx(22,Color(255,255,0)));d.write_state(nullptr);d.cancel_closing_tx();complete(50300);d.loop();complete(50301);d.loop();assert(events.size()==1); // Stop/disconnect revoke; late duplicate inert.
 assert(d.arm_closing_tx(33,Color(255,255,0)));d.paint(Color(255,0,0));d.write_state(nullptr);complete(50400);d.loop();assert(events.size()==1); // Old effect / mute repaint.
 d.paint(Color(255,255,0));assert(d.arm_closing_tx(44,Color(255,255,0)));test_error=1;d.write_state(nullptr);d.loop();assert(events.size()==1); // Failed transmit cannot ACK.
 test_error=0;assert(d.arm_closing_tx(55,Color(255,255,0)));d.write_state(nullptr);complete(50500);d.loop();assert(events.size()==2&&std::get<0>(events.back())==55); // Recovery uses new token.
 assert(!d.arm_closing_tx(0,Color(255,255,0)));assert(!d.arm_closing_tx(66,Color(1,2,3)));
 assert(isr_entries>0 && main_entries>isr_entries && critical_depth==0);
 reset();test_fail_ledger=true;Driver no_memory;setup(no_memory,true);assert(no_memory.is_failed());assert(test_registered==0);assert(!no_memory.arm_closing_tx(88,Color(255,255,0)));no_memory.write_state(nullptr);no_memory.loop();assert(test_transmits==0);test_fail_ledger=false;
 std::cout<<"PASS actual vendored CPP: OFF, old queue before ISR, exact frame, once, revoke, repaint, TX failure/recovery\n";
}
"""
with tempfile.TemporaryDirectory() as folder:
    p = Path(folder)
    (p / "stub.h").write_text(COMMON)
    for header in (
        "esphome/components/light/addressable_light.h",
        "esphome/components/light/light_output.h",
        "esphome/core/color.h",
        "esphome/core/component.h",
        "esphome/core/helpers.h",
        "esphome/core/log.h",
        "driver/gpio.h",
        "esp_err.h",
        "esp_idf_version.h",
        "driver/rmt_tx.h",
        "esp_attr.h",
        "esp_clk_tree.h",
        "esp_timer.h",
        "freertos/FreeRTOS.h",
        "freertos/portmacro.h",
    ):
        h = p / header
        h.parent.mkdir(parents=True, exist_ok=True)
        h.write_text('#include "stub.h"\n')
    (p / "main.cpp").write_text(HARNESS)
    subprocess.run(
        [
            "c++",
            "-std=c++17",
            "-DUSE_ESP32",
            "-I" + str(p),
            "-I" + str(DRIVER),
            str(DRIVER / "led_strip.cpp"),
            str(p / "main.cpp"),
            "-o",
            str(p / "test"),
        ],
        check=True,
    )
    subprocess.run([str(p / "test")], check=True)
