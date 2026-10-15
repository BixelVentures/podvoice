# Roborock native read contract · next source candidate

Source work only, from frozen26 commit c163cfafe9e26474549accebc3382c94504277b3.
No Green configuration, permissions, action, installation or physical test was changed.

The new Supervisor option `podview_robot_read_policy` defaults to an empty string.
An ordinary panel setting cannot grant these reads. An explicit trusted administrator
must prepare version1 JSON with `bindings`, each containing exactly `vacuumEntityId`,
`dockDeviceId` (null when no dock fields), and `fields`. Each field contains exactly
`key` and `entityId`. There are at most12 exact vacuums and64 unique field entities.
The vacuum must already appear in `device_control_entities` with the existing adapter
enabled. That existing setting's limit and existing action declarations are unchanged.

Before activation on Green, record the **actual** active Qrevo vacuum entity ID,
its registry device ID/config-entry ID, and each approved field entity ID/translation key.
For dock fields, record the actual dock device ID and explicitly approve its relation to
that Qrevo. Same account/config entry alone is insufficient; policy binds the exact dock.
The same fresh config-entry, Roborock platform, active entity and exact target device must
match on pre/post registry reads. No friendly-name matching, legacy device fallback or
automatic discovery is allowed. Disabled reset/off-peak entities remain disabled.

The read grant should include only these useful enabled native roles, as actually present:

- Current: `current_room`, `clean_percent`, `cleaning_area`, `cleaning_time`, `battery`,
  `battery_charging`, `in_cleaning`, `status`.
- Native last-clean timestamps/totals: `last_clean_start`, `last_clean_end`,
  `total_cleaning_count`, `total_cleaning_area`, `total_cleaning_time`.
- Robot care: `vacuum_error`, `water_shortage`, `mop_attached`, `water_box_attached`,
  `main_brush_time_left`, `side_brush_time_left`, `filter_time_left`, `sensor_time_left`.
- Dock care: `clean_box_empty`, `dirty_box_full`, `dock_error`, `mop_drying_status`
  (legacy binary sensor if enabled), `mop_drying` (native switch read),
  `mop_drying_remaining_time`, `cleaning_brush_time_left`, `strainer_time_left`.
- Read settings: `mop_intensity`, `mop_mode`, `cleaning_mode`, `selected_map`, `volume`,
  `dnd_switch`, `dnd_start_time`, `dnd_end_time`; dock `child_lock`, `dust_collection_mode`.

The existing Supervisor HA WebSocket owner needs read access to
`config/entity_registry/get_entries` for these **exact** IDs; GET state reads use the
existing HA API owner. No new credentials, broad `/states`, device discovery, service
calls or write permissions are introduced. Admin grants remain unactivated in this patch.

Optional payload under each existing home vacuum row:

```json
{
  "telemetry": {
    "schema": "podview.robot.v1",
    "status": "observed",
    "vacuumEntityId": "vacuum.actual_robot",
    "source": "home_assistant_roborock",
    "items": [
      {
        "key": "cleaning_area",
        "entityId": "sensor.actual_cleaning_area",
        "value": 23.5,
        "unit": "m²",
        "updatedAt": 1792010000,
        "retrievedAt": 1792010001,
        "stale": false
      }
    ]
  }
}
```

Above values are illustrative contract values, not actual Green evidence. Unknown,
unavailable, wrong-unit or missing-time fields are omitted. HA `last_reported`, with
`last_updated` fallback, is the source freshness marker;300s makes a field stale.
Negative maintenance values are preserved. The whole extra observation has a5s budget;
timeout retains basic vacuum status and reports extra fields unavailable. Registry or
config changes discard old results. The existing home ingress owner/session/cache fences
remain unchanged. Reads are separate observations, not an atomic cleaning record.

PodView displays room/progress/area/time only while freshly observed cleaning; dock's old
room is not active cleaning. Native last-start/end are distinct from durable start-request
receipts, with no derived duration/completion/ETA. This source exposes only the latest
native timestamps and totals; it does not invent a multi-run completed-clean history.
Care/dock/read settings stay in collapsed “Pleje og indstillinger”. No field creates
buttons, capabilities, map imagery, new routines, maintenance resets or physical proof.
Existing task-bound room/settings/repeat/reuse controls retain their existing owners.

Role/domain/unit definitions checked against primary Home Assistant sources:
[sensor](https://raw.githubusercontent.com/home-assistant/core/dev/homeassistant/components/roborock/sensor.py),
[binary sensor](https://raw.githubusercontent.com/home-assistant/core/dev/homeassistant/components/roborock/binary_sensor.py),
[select](https://raw.githubusercontent.com/home-assistant/core/dev/homeassistant/components/roborock/select.py),
[switch](https://raw.githubusercontent.com/home-assistant/core/dev/homeassistant/components/roborock/switch.py),
[time](https://raw.githubusercontent.com/home-assistant/core/dev/homeassistant/components/roborock/time.py),
[number](https://raw.githubusercontent.com/home-assistant/core/dev/homeassistant/components/roborock/number.py).
The running Green registry remains the admission authority; upstream dev definitions
do not prove the installed Core's entity names or availability.
