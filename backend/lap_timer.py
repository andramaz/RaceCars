"""
lap_timer.py — Lap detection (distance-based or sonar-based).

Distance mode (default):
    Accumulates fake odometry (speed × dt) and counts a lap every
    LAP_DISTANCE_M metres.  Speed is estimated from throttle %.

Sonar mode (legacy):
    Triggers when either sonar sensor reads below SONAR_THRESHOLD_CM.

Usage:
    from lap_timer import lap_timer
    lap_timer.tick(speed_ms, dt)   # call each telemetry tick (distance mode)
    lap_timer.check(sonar_dict)    # call each telemetry tick (sonar mode)
    lap_timer.reset()              # call at session start
"""

import time

# ── Distance mode config ───────────────────────────────────────────────────
LAP_DISTANCE_M = 1.0   # metres per lap

# ── Sonar mode config (legacy) ─────────────────────────────────────────────
SONAR_THRESHOLD_CM = 25.0
LAP_COOLDOWN_S     = 3.0


class LapTimer:
    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self._lap_start:   float       = 0.0
        self._last_cross:  float       = 0.0
        self._laps:        list[float] = []
        self._armed:       bool        = False
        self._distance_m:  float       = 0.0   # cumulative distance in current lap

    # ── Distance-based tick (called from telemetry_loop every 100 ms) ──────

    def tick(self, speed_ms: float, dt: float) -> float | None:
        """
        Accumulate distance and count a lap every LAP_DISTANCE_M metres.
        speed_ms: current speed in m/s (estimated from throttle)
        dt:       elapsed seconds since last tick
        Returns completed lap duration on a new lap, otherwise None.
        """
        if speed_ms <= 0:
            return None

        self._distance_m += speed_ms * dt

        if self._distance_m < LAP_DISTANCE_M:
            return None

        # Lap complete
        self._distance_m -= LAP_DISTANCE_M   # carry over excess distance
        now = time.time()

        if not self._armed:
            self._lap_start = now
            self._armed     = True
            print(f"[LAP] First lap started (distance mode)")
            return None

        lap_s = round(now - self._lap_start, 2)
        self._laps.append(lap_s)
        self._lap_start = now
        print(f"[LAP] Lap {len(self._laps)} — {lap_s}s  ({LAP_DISTANCE_M}m)")
        return lap_s

    # ── Manual lap trigger ─────────────────────────────────────────────────

    def manual_lap(self) -> float | None:
        """
        Called when user presses the LAP button.
        First press starts the timer, subsequent presses record a lap.
        """
        now = time.time()
        if not self._armed:
            self._lap_start = now
            self._armed     = True
            print("[LAP] Manual — timer started")
            return None
        lap_s = round(now - self._lap_start, 2)
        self._laps.append(lap_s)
        self._lap_start = now
        print(f"[LAP] Manual lap {len(self._laps)} — {lap_s}s")
        return lap_s

    # ── Sonar-based check (legacy, kept for compatibility) ──────────────────

    def check(self, sonar: dict | None) -> float | None:
        if not sonar:
            return None

        l_cm = sonar.get("lCm")
        r_cm = sonar.get("rCm")
        distances = [d for d in (l_cm, r_cm) if d is not None]
        if not distances:
            return None

        now      = time.time()
        min_dist = min(distances)

        if min_dist >= SONAR_THRESHOLD_CM:
            return None
        if now - self._last_cross < LAP_COOLDOWN_S:
            return None

        self._last_cross = now

        if not self._armed:
            self._lap_start = now
            self._armed     = True
            print(f"[LAP] Gate crossed — lap timer started")
            return None

        lap_s = round(now - self._lap_start, 2)
        self._laps.append(lap_s)
        self._lap_start = now
        print(f"[LAP] Lap {len(self._laps)} completed — {lap_s}s")
        return lap_s

    @property
    def laps(self) -> list[float]:
        return list(self._laps)

    @property
    def lap_count(self) -> int:
        return len(self._laps)

    @property
    def best_lap(self) -> float | None:
        return min(self._laps) if self._laps else None

    @property
    def last_lap(self) -> float | None:
        return self._laps[-1] if self._laps else None

    @property
    def distance_m(self) -> float:
        return round(self._distance_m, 2)


# Module-level singleton shared by main.py and database.py
lap_timer = LapTimer()
