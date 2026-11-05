# Native timer v2 · 5 November 2026

Existing HA Core intent TimerManager owns time, expiry and IDs. The v2 alias extends the same bridge/receipt ledger; v1 stays compatible. No new timer engine, countdown owner, command bus, poller or frontend framework.

| Input | Observed software result | Evidence / limit |
| --- | --- | --- |
| Active ±60; paused +60 | Same native ID, native duration/revision, paused remains paused | Actual touch journey through inert Core/service seam; separate actual Core service tests |
| Lost native HTTP response | One same-signature, same-alias read-only lookup; no second effect | Correlated request/receipt and native effect counters |
| UNKNOWN | Honest unknown then newer native revision supersedes; never accepted/observed/confirmed | Persisted journal, native CAS and read/mutation fences |
| Cancel during held adjust | Native Cancel before release; late response does not restore timer | Actual browser race; old failure retained in temporary evidence |
| Minimum/maximum | Minus disabled at60; plus disabled at86400 | Actual touch/detail views |
| Normal/pending UI | Stable64px controls, centered16px spinner, independent Cancel, readable disabled icon | Stable1280/1200 images; existing canonical library TimerView/stepper references |
| Logging | Original Start observed; signed ±; closed native UNKNOWN phase/recovery and safe native_ref correlation | Persisted browser journey plus focused native fault/log cases; logging-only final delta does not change effects or wire |

Full UI/component suite4736 PASS. Focused native55, actual pinned Core framework3, adapter81 plus named final closures30, PodView bridge91 and targeted hash logging cases passed; Ruff/Mypy/AST/source/build pins checked. These are distinct evidence layers, not physical acceptance. Source was grilled by Astra; actual probes found and closed global-revision rejection, cancellation queuing, disabled icon contrast and dropped Start observation. A transient CDP-resize screenshot was rejected and recaptured after actual finite animations and two stable frames; no animations/clones were hidden.

Publication, installation and physical acceptance remain separate. Native integration version/update packaging is owned by the common release lead; v2must be loaded and discovered on Green. Updating only the add-on must retain v1controls and must not fabricate adjustment capability. No real audio trials before6November08:00 Copenhagen. Real iPad/VoicePE/alert-drain acceptance remains open.
