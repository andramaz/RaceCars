/**
 * AppContext.js
 *
 * Global state for the RC Car app:
 *   - WebSocket connection lifecycle (connect / disconnect / send)
 *   - Latest telemetry snapshot
 *   - Event log (commands sent, safety events, connection events)
 *
 * All screens import `useApp()` to access this shared state.
 */

import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
} from 'react';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // WebSocket URL that the user types in ConnectionScreen.
  const [wsUrl, setWsUrl] = useState('ws://192.168.1.10:8000/ws');

  // Connection state
  const [connected,     setConnected]     = useState(false);
  const [signalQuality, setSignalQuality] = useState('--');
  const [lastUpdate,    setLastUpdate]    = useState(null);

  // Latest telemetry object received from backend.
  const [telemetry, setTelemetry] = useState(null);

  // Event log entries — newest first, capped at 150.
  const [logs, setLogs] = useState([]);

  // Live WebSocket reference (not state — we don't want renders on change).
  const wsRef              = useRef(null);
  const reconnectTimerRef  = useRef(null);
  const reconnectingRef    = useRef(false);
  const lastUrlRef         = useRef(null);

  // Direct ESP32 connection (bypasses backend for drive commands)
  const esp32UrlRef    = useRef(null);
  const servoConfigRef = useRef({ minUs: 1700, neutralUs: 2000, maxUs: 2300 });
  const escConfigRef   = useRef({ minUs: 1370, neutralUs: 1470, maxUs: 1600 });

  // App-side fail-safe: track last direct command time
  const lastDirectRef    = useRef(0);
  const failSafeTimerRef = useRef(null);

  // Track previous safety states so we only log on *changes*, not every tick.
  const prevEmergencyRef = useRef(false);
  const prevFailSafeRef  = useRef(false);

  // -----------------------------------------------------------------------
  // Log helpers
  // -----------------------------------------------------------------------

  const addLog = useCallback((message, type = 'info') => {
    const entry = {
      id:        Date.now() + Math.random(), // unique even if called in same ms
      timestamp: new Date().toLocaleTimeString(),
      message,
      type, // 'info' | 'command' | 'emergency' | 'failsafe' | 'error'
    };
    setLogs(prev => [entry, ...prev].slice(0, 150));
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  // -----------------------------------------------------------------------
  // WebSocket lifecycle
  // -----------------------------------------------------------------------

  const _scheduleReconnect = useCallback((url) => {
    if (reconnectTimerRef.current) return; // already scheduled
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (reconnectingRef.current) {
        connectInternal(url, true);
      }
    }, 2000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connectInternal = useCallback((url, isReconnect = false) => {
    if (wsRef.current) {
      wsRef.current.onclose = null; // prevent old socket from triggering reconnect
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    if (!isReconnect) {
      addLog(`Connecting to ${url}…`, 'info');
    }

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        if (isReconnect) {
          addLog(`Reconnected to ${url}`, 'info');
        } else {
          addLog(`Connected to ${url}`, 'info');
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'config') {
            esp32UrlRef.current = data.esp32_url || null;
            if (data.servo) servoConfigRef.current = data.servo;
            if (data.esc)   escConfigRef.current   = data.esc;
            addLog(`ESP32 direkt bağlantı: ${data.esp32_url}`, 'info');
            return;
          }

          if (data.type === 'telemetry') {
            setTelemetry(data);
            setSignalQuality(data.signal_quality || '--');
            setLastUpdate(new Date().toLocaleTimeString());

            if (data.emergency_stop && !prevEmergencyRef.current) {
              addLog('⚠ EMERGENCY STOP activated by backend', 'emergency');
            }
            if (!data.emergency_stop && prevEmergencyRef.current) {
              addLog('Emergency stop cleared', 'info');
            }
            prevEmergencyRef.current = data.emergency_stop;

            if (data.fail_safe && !prevFailSafeRef.current) {
              addLog('⚠ FAIL-SAFE activated — no commands received for >1 s', 'failsafe');
            }
            if (!data.fail_safe && prevFailSafeRef.current) {
              addLog('Fail-safe cleared — commands flowing again', 'info');
            }
            prevFailSafeRef.current = data.fail_safe;
          }
        } catch (e) {
          addLog(`Parse error: ${e.message}`, 'error');
        }
      };

      ws.onerror = () => {
        // error is always followed by onclose — let onclose handle reconnect
      };

      ws.onclose = () => {
        setConnected(false);
        setTelemetry(null);
        setSignalQuality('--');
        if (reconnectingRef.current) {
          addLog('Connection lost — retrying in 2s…', 'error');
          _scheduleReconnect(url);
        } else {
          addLog('Disconnected from backend', 'info');
        }
      };
    } catch (e) {
      addLog(`Could not open WebSocket: ${e.message}`, 'error');
      if (reconnectingRef.current) {
        _scheduleReconnect(url);
      }
    }
  }, [addLog, _scheduleReconnect]);

  const connect = useCallback((url) => {
    const target = url || wsUrl;
    lastUrlRef.current      = target;
    reconnectingRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    connectInternal(target, false);
  }, [wsUrl, connectInternal]);


  const disconnect = useCallback(() => {
    reconnectingRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
    setTelemetry(null);
    setSignalQuality('--');
  }, []);


  const sendCommand = useCallback((command) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(command));

      if (command.type === 'emergency_stop') {
        addLog('🛑 EMERGENCY STOP sent', 'emergency');
      } else if (command.type === 'reset_emergency_stop') {
        addLog('Emergency stop RESET sent', 'info');
      }
    } else {
      addLog('Send failed — not connected', 'error');
    }
  }, [addLog]);

  // ── Direct ESP32 drive (bypasses backend) ─────────────────────────────────

  const _steeringToUs = (pct) => {
    const s = servoConfigRef.current;
    if (pct >= 0) return Math.round(s.neutralUs + (pct / 100) * (s.maxUs - s.neutralUs));
    return Math.round(s.neutralUs + (pct / 100) * (s.neutralUs - s.minUs));
  };

  const _throttleToUs = (pct) => {
    const e = escConfigRef.current;
    if (pct >= 0) return Math.round(e.neutralUs + (pct / 100) * (e.maxUs - e.neutralUs));
    return Math.round(e.neutralUs + (pct / 100) * (e.neutralUs - e.minUs));
  };

  const lastDirectSentRef = useRef(0);

  const sendDirect = useCallback((steering, throttle) => {
    const url = esp32UrlRef.current;
    if (!url) return;
    const now = Date.now();
    if (now - lastDirectSentRef.current < 150) return; // max ~7 req/s
    lastDirectSentRef.current = now;
    const steerUs = _steeringToUs(Math.round(steering));
    const thrUs   = _throttleToUs(Math.round(throttle));
    lastDirectRef.current = now;

    // Fire-and-forget — don't await, don't block
    fetch(`${url}/control?steer=${steerUs}&thr=${thrUs}`, { method: 'POST' })
      .catch(() => {}); // silently ignore failures

    // App-side fail-safe: if no command for 1s, send neutral
    clearTimeout(failSafeTimerRef.current);
    failSafeTimerRef.current = setTimeout(() => {
      const neutralSteer = _steeringToUs(0);
      const neutralThr   = _throttleToUs(0);
      fetch(`${url}/control?steer=${neutralSteer}&thr=${neutralThr}`, { method: 'POST' })
        .catch(() => {});
    }, 1000);
  }, []);

  // -----------------------------------------------------------------------
  // Context value
  // -----------------------------------------------------------------------

  return (
    <AppContext.Provider
      value={{
        wsUrl, setWsUrl,
        connected,
        signalQuality,
        lastUpdate,
        telemetry,
        logs,
        connect,
        sendDirect,
        disconnect,
        sendCommand,
        addLog,
        clearLogs,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp() must be called inside <AppProvider>');
  return ctx;
}
