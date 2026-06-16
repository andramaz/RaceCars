"""
lap_timer.py — Sonar-based lap detection.

Triggers a lap crossing when either sonar sensor reads below
SONAR_THRESHOLD_CM.  A LAP_COOLDOWN_S guard prevents the same
gate from being counted twice in quick succession.

Usage (singleton pattern):
    from lap_timer import lap_timer
    new_lap = lap_timer.check(sonar_dict)   # call each telemetry tick
    lap_timer.reset()                        # call at session start
"""

import time

SONAR_THRESHOLD_CM = 25.0   # gate width — object closer than this triggers a crossing
LAP_COOLDOWN_S     = 3.0    # minimum seconds between two valid crossings


class LapTimer:
    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self._lap_start: float       = 0.0
        self._last_cross: float      = 0.0
        self._laps:       list[float] = []
        self._armed:      bool        = False   # True after first gate crossing

    def check(self, sonar: dict | None) -> float | None:
        """
        Call once per telemetry tick with the sonar dict from the ESP32.
        Returns the completed lap duration (seconds) if a lap just finished,
        otherwise returns None.
        """
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
            return None  # nothing near the gate

        # Enforce cooldown between crossings
        if now - self._last_cross < LAP_COOLDOWN_S:
            return None

        self._last_cross = now

        if not self._armed:
            # First crossing: start the clock
            self._lap_start = now
            self._armed     = True
            print(f"[LAP] Gate crossed — lap timer started")
            return None

        # Subsequent crossing: record the lap
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


# Module-level singleton shared by main.py and database.py
lap_timer = LapTimer()
