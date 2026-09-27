"""Conservative native quiet-window policy; never a provider audio-done or drain ACK."""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class _Sample:
    owner: tuple
    received: float
    sequence: int
    source_ms: int
    input_sequence: int
    input_ms: int
    input_sample: int
    mix_sequence: int
    mix_ms: int
    begin: int
    end: int
    consumed: int
    rate: int
    empty: bool
    provisional: bool


class NativeIdleWindow:
    """Measure a continuous current-owner quiet interval from native observations.

    ``freshness_s`` is an explicit reporting policy, not an acoustic threshold.
    Nonempty output counts only exact zero samples consumed inside contiguous native
    source coverage. The separate never-started path requires an explicitly empty
    producer/resampler/source chain. Neither path declares physical playback finished.
    Callers reset on new provider output/input/work and retain the close transaction.
    """

    def __init__(self, *, freshness_s: float, require_input_quiet: bool = True) -> None:
        if not math.isfinite(freshness_s) or freshness_s <= 0:
            raise ValueError("freshness must be finite and positive")
        self.freshness_s = freshness_s
        self.require_input_quiet = require_input_quiet
        self.reset()

    def reset(self, reason: str = "external_reset") -> None:
        self.reset_reason = reason
        self.reset_count = getattr(self, "reset_count", 0) + 1
        self._last: _Sample | None = None
        self._coverage: _Sample | None = None
        self._source_elapsed = 0.0
        self._arrival_lag = 0.0
        self._minimum_lag = 0.0
        self._zero_start = 0
        self._anchor: tuple[float, float, int] | None = None

    @staticmethod
    def _delta_ms(current: int, previous: int) -> int:
        return (current - previous) & 0xFFFFFFFF

    def _sample(self, row: dict, owner: tuple, now: float, output_started: bool) -> _Sample:
        if row["source"] != "voice_pe_firmware":
            raise ValueError("not native")
        received = row["received_monotonic"]
        if (
            type(received) not in (int, float)
            or not math.isfinite(received)
            or not 0 <= now - received <= self.freshness_s
        ):
            raise ValueError("not current arrival")

        def number(data: dict, key: str) -> int:
            value = data[key]
            if type(value) is not int or not 0 <= value < 2**64:
                raise ValueError("invalid counter")
            return value

        source_ms = number(row, "source_timestamp_ms")
        if source_ms > 0xFFFFFFFF:
            raise ValueError("invalid clock")
        native_owner = tuple(
            row[k]
            for k in (
                "native_session",
                "native_generation",
                "native_connection",
                "native_reset",
                "reply_token",
                "playback_id",
            )
        )
        out = row["output"]
        begin, end, consumed = (
            number(out, k) for k in ("frame_begin", "frame_end", "consumed_frames")
        )
        rate, count = number(out, "sample_rate"), number(out, "sample_count")
        empty = not output_started
        provisional = not empty and out["valid"] is False and count == 0
        if empty:
            if not (
                out["valid"] is False
                and count == 0
                and begin == end == consumed
                and all(
                    out[k] is True
                    for k in ("producer_idle", "resampler_quiescent", "source_quiescent")
                )
            ):
                raise ValueError("empty chain not established")
        elif provisional:
            if not (
                rate > 0
                and begin == end
                and consumed <= end
                and number(out, "peak") == number(out, "sum_squares") == 0
                and self._delta_ms(source_ms, number(out, "mix_ms")) <= self.freshness_s * 1000
            ):
                raise ValueError("empty snapshot has no preserved coverage")
        elif not (
            out["valid"] is True
            and rate > 0
            and count > 0
            and begin < end
            and number(out, "peak") == number(out, "sum_squares") == 0
            and consumed <= end
            and self._delta_ms(source_ms, number(out, "mix_ms")) <= self.freshness_s * 1000
        ):
            raise ValueError("zero source coverage not established")
        input_sequence = input_ms = input_sample = 0
        input_owner: tuple = ()
        if self.require_input_quiet:
            inp = row["input"]
            if not (inp["valid"] is True and inp["state"] == "quiet"):
                raise ValueError("input not quiet")
            input_sequence, input_ms, input_sample = (
                number(inp, k) for k in ("inference_seq", "inference_ms", "sample_end")
            )
            if self._delta_ms(source_ms, input_ms) > self.freshness_s * 1000:
                raise ValueError("input observation aged")
            input_owner = (number(inp, "capture_epoch"), number(inp, "detector_run"))
        return _Sample(
            (*owner, *native_owner, *input_owner, number(out, "source_epoch"), rate, empty),
            received,
            number(row, "sequence"),
            source_ms,
            input_sequence,
            input_ms,
            input_sample,
            number(out, "mix_seq"),
            number(out, "mix_ms"),
            begin,
            end,
            consumed,
            rate,
            empty,
            provisional,
        )

    def _baseline(self, sample: _Sample, reason: str = "baseline") -> None:
        self.reset(reason)
        self._last = sample
        self._zero_start = sample.begin
        if not sample.empty:
            self._coverage = sample

    def observe(
        self, row: dict, *, owner: tuple, now: float, work_clear: bool, output_started: bool
    ) -> None:
        if not work_clear or not math.isfinite(now):
            self.reset("pending_work" if not work_clear else "invalid_clock")
            return
        try:
            sample = self._sample(row, owner, now, output_started)
        except ValueError as exc:
            self.reset(str(exc).replace(" ", "_"))
            return
        except (KeyError, TypeError, OverflowError):
            self.reset("malformed_observation")
            return
        previous = self._last
        if previous is None or previous.owner != sample.owner:
            if sample.provisional:
                self.reset("provisional_without_baseline")
                return
            self._baseline(sample, "owner_changed" if previous is not None else "baseline")
            return
        host_delta = sample.received - previous.received
        source_delta = self._delta_ms(sample.source_ms, previous.source_ms) / 1000
        advancing = (
            sample.sequence == previous.sequence + 1
            and 0 < host_delta <= self.freshness_s
            and 0 < source_delta <= self.freshness_s
        )
        if self.require_input_quiet:
            advancing = advancing and (
                sample.input_sequence > previous.input_sequence
                and sample.input_sample > previous.input_sample
                and 0
                < self._delta_ms(sample.input_ms, previous.input_ms)
                <= self.freshness_s * 1000
            )
        if not sample.empty:
            coverage = self._coverage
            advancing = advancing and coverage is not None
            if coverage is not None:
                advancing = advancing and (
                    sample.begin == coverage.end and sample.consumed >= previous.consumed
                )
                if sample.provisional:
                    # take() resets the interval metrics, but its old mix identity
                    # and covered end must remain exact. This heartbeat cannot
                    # authorize closure; only a later valid contiguous interval can.
                    advancing = advancing and (
                        sample.end == coverage.end
                        and sample.mix_sequence == coverage.mix_sequence
                        and sample.mix_ms == coverage.mix_ms
                    )
                else:
                    advancing = advancing and (
                        sample.mix_sequence > coverage.mix_sequence
                        and 0
                        < self._delta_ms(sample.mix_ms, coverage.mix_ms)
                        <= self.freshness_s * 1000
                    )
        self._arrival_lag += host_delta - source_delta
        self._minimum_lag = min(self._minimum_lag, self._arrival_lag)
        if not advancing or self._arrival_lag - self._minimum_lag > self.freshness_s:
            reason = "discontinuous_observation" if not advancing else "arrival_lag"
            if sample.sequence != previous.sequence + 1:
                reason = "sequence_gap"
            elif not 0 < host_delta <= self.freshness_s:
                reason = "arrival_gap"
            elif not 0 < source_delta <= self.freshness_s:
                reason = "source_gap"
            elif self.require_input_quiet and (
                sample.input_sequence <= previous.input_sequence
                or sample.input_sample <= previous.input_sample
            ):
                reason = "input_not_advancing"
            self.reset(reason)
            return
        self._source_elapsed += source_delta
        self._last = sample
        if sample.provisional:
            return
        if not sample.empty:
            self._coverage = sample
        if not sample.empty and (
            previous.consumed < self._zero_start or sample.consumed == previous.consumed
        ):
            self._anchor = None  # No newly consumed, wholly observed zero interval yet.
            return
        if self._anchor is None:
            self._anchor = (
                previous.received,
                self._source_elapsed - source_delta,
                previous.consumed,
            )

    def diagnostics(self, *, owner: tuple, now: float, idle_s: float) -> dict:
        """Content-free policy evidence; reading this never advances quiet coverage."""
        sample, anchor = self._last, self._anchor
        age = now - sample.received if sample is not None and math.isfinite(now) else None
        duration = 0.0
        if sample is None:
            blocker = self.reset_reason
        elif sample.provisional:
            blocker = "provisional_output"
        elif anchor is None:
            blocker = "no_consumed_quiet_anchor"
        elif sample.owner[: len(owner)] != owner:
            blocker = "owner_changed"
        elif not math.isfinite(now) or not math.isfinite(idle_s) or idle_s <= 0:
            blocker = "invalid_clock"
        elif age is None or not 0 <= age <= self.freshness_s:
            blocker = "stale_observation"
        else:
            duration = min(sample.received - anchor[0], self._source_elapsed - anchor[1])
            if not sample.empty:
                duration = min(duration, (sample.consumed - anchor[2]) / sample.rate)
            blocker = "ready" if duration >= idle_s else "quiet_window_incomplete"
        return {
            "blocker": blocker,
            "reset_reason": self.reset_reason,
            "reset_count": self.reset_count,
            "quiet_s": duration,
            "observation_age_s": age,
            "freshness_s": self.freshness_s,
        }

    def ready(self, *, owner: tuple, now: float, idle_s: float) -> bool:
        return self.diagnostics(owner=owner, now=now, idle_s=idle_s)["blocker"] == "ready"
