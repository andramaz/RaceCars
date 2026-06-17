"""
lap_timer.py — Manual lap timer.

First LAP button press starts the timer; each subsequent press records a lap.
"""

import time


class LapTimer:
    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self._lap_start: float       = 0.0
        self._laps:      list[float] = []
        self._armed:     bool        = False

    def manual_lap(self) -> float | None:
        now = time.time()
        if not self._armed:
            self._lap_start = now
            self._armed     = True
            print("[LAP] Timer started")
            return None
        lap_s = round(now - self._lap_start, 2)
        self._laps.append(lap_s)
        self._lap_start = now
        print(f"[LAP] Lap {len(self._laps)} — {lap_s}s")
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
