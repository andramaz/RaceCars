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
  const wsRef = useRef(null);

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

  const connect = useCallback((url) => {
    const target = url || wsUrl;

    // Close any existing connection first.
    if (wsRef.current) {
      wsRef.current.close();
    }

    addLog(`Connecting to ${target}…`, 'info');

    try {
      const ws = new WebSocket(target);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        addLog(`Connected to ${target}`, 'info');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'telemetry') {
            setTelemetry(data);
            setSignalQuality(data.signal_quality || '--');
            setLastUpdate(new Date().toLocaleTimeString());

            // Log emergency_stop only when it transitions ON or OFF.
            if (data.emergency_stop && !prevEmergencyRef.current) {
              addLog('⚠ EMERGENCY STOP activated by backend', 'emergency');
            }
            if (!data.emergency_stop && prevEmergencyRef.current) {
              addLog('Emergency stop cleared', 'info');
            }
            prevEmergencyRef.current = data.emergency_stop;

            // Log fail_safe only on transition.
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
        addLog('WebSocket error — check IP address and backend status', 'error');
        setConnected(false);
      };

      ws.onclose = () => {
        setConnected(false);
        setTelemetry(null);
        setSignalQuality('--');
        addLog('Disconnected from backend', 'info');
      };
    } catch (e) {
      addLog(`Could not open WebSocket: ${e.message}`, 'error');
    }
  }, [wsUrl, addLog]);


  const disconnect = useCallback(() => {
    if (wsRef.current) {
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
      } else if (command.type === 'command') {
        addLog(
          `CMD  steering=${command.steering > 0 ? '+' : ''}${command.steering}  throttle=${command.throttle}  mode=${command.mode}`,
          'command',
        );
      }
    } else {
      addLog('Send failed — not connected', 'error');
    }
  }, [addLog]);

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
