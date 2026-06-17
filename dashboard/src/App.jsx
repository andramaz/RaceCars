/**
 * App.jsx — RC Car Web Dashboard
 *
 * Connects to the FastAPI backend via WebSocket.
 * Tabs: Live telemetry · Control (joystick) · History
 *
 * Run with:  npm run dev   (inside the dashboard/ folder)
 */

import React, { useState, useRef, useCallback, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

// ── Design tokens ─────────────────────────────────────────────────────────

const C = {
  bg:         '#0d1117',
  surface:    '#161b22',
  surfaceAlt: '#21262d',
  primary:    '#58a6ff',
  primaryDark:'#1f6feb',
  success:    '#3fb950',
  danger:     '#f85149',
  warning:    '#d29922',
  text:       '#e6edf3',
  muted:      '#8b949e',
  border:     '#30363d',
}

const MAX_POINTS = 60   // 30 s at 500 ms

// ── Root component ────────────────────────────────────────────────────────

export default function App() {
  const [wsUrl,     setWsUrl]     = useState(() => {
    const h = (typeof location !== 'undefined' && location.hostname && location.hostname !== '127.0.0.1')
      ? location.hostname : 'localhost'
    return `ws://${h}:8000/ws`
  })
  const [connected, setConnected] = useState(false)
  const [telemetry, setTelemetry] = useState(null)
  const [chartData, setChartData] = useState([])
  const [logs,      setLogs]      = useState([])
  const [summary,   setSummary]   = useState(null)
  const [fetching,  setFetching]  = useState(false)
  const [activeTab, setActiveTab] = useState('live')

  // History
  const [sessions,        setSessions]        = useState([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [influxEnabled,   setInfluxEnabled]   = useState(null)
  const [selectedSession, setSelectedSession] = useState(null)
  const [sessionData,     setSessionData]     = useState(null)
  const [loadingSession,  setLoadingSession]  = useState(false)

  const wsRef            = useRef(null)
  const prevEmergencyRef = useRef(false)
  const prevFailSafeRef  = useRef(false)
  const reconnectRef     = useRef(null)   // setTimeout handle
  const shouldReconnect  = useRef(false)  // false after manual disconnect

  // ── Log helper ───────────────────────────────────────────────────────────

  const addLog = useCallback((msg, type = 'info') => {
    setLogs(prev => [{
      id:   Date.now() + Math.random(),
      time: new Date().toLocaleTimeString(),
      msg,
      type,
    }, ...prev].slice(0, 120))
  }, [])

  // ── WebSocket ─────────────────────────────────────────────────────────────

  const sendWs = useCallback((obj) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ ...obj, timestamp: Math.floor(Date.now() / 1000) }))
    }
  }, [])

  const connectToUrl = (url, isRetry = false) => {
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.onerror = null
      wsRef.current.close()
      wsRef.current = null
    }
    if (!isRetry) addLog(`Connecting to ${url}…`)

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      addLog(isRetry ? `Reconnected to ${url}` : `Connected to ${url}`, 'success')
    }

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data)
      if (data.type !== 'telemetry') return

      setTelemetry(data)

      const label = new Date().toLocaleTimeString('en', {
        hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
      setChartData(prev => [
        ...prev.slice(-(MAX_POINTS - 1)),
        { time: label, speed: data.speed, battery: data.battery_percentage, steering: data.current_steering },
      ])

      if (data.emergency_stop && !prevEmergencyRef.current)
        addLog('EMERGENCY STOP activated', 'danger')
      if (!data.emergency_stop && prevEmergencyRef.current)
        addLog('Emergency stop cleared', 'success')
      prevEmergencyRef.current = data.emergency_stop

      if (data.fail_safe && !prevFailSafeRef.current)
        addLog('FAIL-SAFE activated — no commands received', 'warning')
      if (!data.fail_safe && prevFailSafeRef.current)
        addLog('Fail-safe cleared', 'success')
      prevFailSafeRef.current = data.fail_safe
    }

    ws.onerror = () => {}  // onclose handles everything

    ws.onclose = () => {
      setConnected(false)
      setTelemetry(null)
      if (shouldReconnect.current) {
        addLog('Connection lost — retrying in 2s…', 'warning')
        reconnectRef.current = setTimeout(() => connectToUrl(url, true), 2000)
      } else {
        addLog('Disconnected')
      }
    }
  }

  const connect = () => {
    shouldReconnect.current = true
    if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null }
    connectToUrl(wsUrl, false)
  }

  const disconnect = () => {
    shouldReconnect.current = false
    if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null }
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.onerror = null
      wsRef.current.close()
      wsRef.current = null
    }
    setConnected(false)
    setTelemetry(null)
    addLog('Disconnected')
  }

  // ── Race summary ─────────────────────────────────────────────────────────

  const fetchSummary = async () => {
    setFetching(true)
    try {
      const base = wsUrl.replace(/^ws:\/\//, 'http://').replace(/\/ws$/, '')
      const res  = await fetch(`${base}/api/race-summary`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSummary(await res.json())
      addLog('Race summary loaded', 'success')
    } catch (err) {
      addLog(`Failed to load summary: ${err.message}`, 'danger')
    } finally {
      setFetching(false)
    }
  }

  // ── History ───────────────────────────────────────────────────────────────

  const base = () => wsUrl.replace(/^ws:\/\//, 'http://').replace(/\/ws$/, '')

  const fetchSessions = async () => {
    setLoadingSessions(true)
    setSessions([])
    setSelectedSession(null)
    setSessionData(null)
    try {
      const res  = await fetch(`${base()}/api/history/sessions`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setInfluxEnabled(data.influx_enabled)
      setSessions(data.sessions || [])
    } catch (err) {
      addLog(`History fetch failed: ${err.message}`, 'danger')
    } finally {
      setLoadingSessions(false)
    }
  }

  const fetchSessionDetail = async (sessionId) => {
    setLoadingSession(true)
    setSelectedSession(sessionId)
    setSessionData(null)
    try {
      const res  = await fetch(`${base()}/api/history/sessions/${sessionId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSessionData(await res.json())
    } catch (err) {
      addLog(`Session load failed: ${err.message}`, 'danger')
    } finally {
      setLoadingSession(false)
    }
  }

  // ── Derived display values ────────────────────────────────────────────────

  const t           = telemetry
  const signalColor = { good: C.success, medium: C.warning, poor: C.danger }[t?.signal_quality] ?? C.muted
  const battColor   = !t ? C.muted : t.battery_percentage > 50 ? C.success : t.battery_percentage > 20 ? C.warning : C.danger
  const motorColor  = { ARMED: C.success, DISARMED: C.muted, EMERGENCY: C.danger }[t?.motor_state] ?? C.muted

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={s.app}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.logo}>RC Car Dashboard</span>
          <span style={{ ...s.badge, color: connected ? C.success : C.danger, borderColor: connected ? C.success : C.danger, background: (connected ? C.success : C.danger) + '22' }}>
            {connected ? '● Connected' : '○ Disconnected'}
          </span>
        </div>
        <div style={s.headerRight}>
          <input
            style={s.urlInput}
            value={wsUrl}
            onChange={e => setWsUrl(e.target.value)}
            placeholder="ws://localhost:8000/ws"
            disabled={connected}
          />
          <button
            style={{ ...s.btn, background: connected ? C.danger : C.primaryDark }}
            onClick={connected ? disconnect : connect}
          >
            {connected ? 'Disconnect' : 'Connect'}
          </button>
        </div>
      </header>

      {/* ── Tab bar ────────────────────────────────────────────────────── */}
      <div style={s.tabBar}>
        {[['live', '● Live'], ['control', '⊕ Control'], ['history', '◷ History']].map(([tab, label]) => (
          <button
            key={tab}
            style={{
              ...s.tabBtn,
              color:        activeTab === tab ? C.primary : C.muted,
              borderBottom: activeTab === tab ? `2px solid ${C.primary}` : '2px solid transparent',
              background:   'none',
            }}
            onClick={() => { setActiveTab(tab); if (tab === 'history' && sessions.length === 0) fetchSessions() }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Safety banners ──────────────────────────────────────────────── */}
      {t?.emergency_stop && (
        <div style={{ ...s.banner, borderColor: C.danger, background: C.danger + '22', color: C.danger }}>
          EMERGENCY STOP IS ACTIVE — throttle is locked at 0
        </div>
      )}
      {t?.fail_safe && (
        <div style={{ ...s.banner, borderColor: C.warning, background: C.warning + '22', color: C.warning }}>
          FAIL-SAFE ACTIVE — backend received no command for &gt;1 s
        </div>
      )}

      <main style={s.main}>

        {/* ══ CONTROL TAB ══════════════════════════════════════════════════ */}
        {activeTab === 'control' && (
          <ControlTab
            connected={connected}
            telemetry={t}
            sendWs={sendWs}
            addLog={addLog}
          />
        )}

        {/* ══ HISTORY TAB ══════════════════════════════════════════════════ */}
        {activeTab === 'history' && (
          <HistoryTab
            sessions={sessions}
            loading={loadingSessions}
            influxEnabled={influxEnabled}
            onRefresh={fetchSessions}
            onSelectSession={fetchSessionDetail}
            selectedSession={selectedSession}
            sessionData={sessionData}
            loadingSession={loadingSession}
          />
        )}

        {/* ══ LIVE TAB ═════════════════════════════════════════════════════ */}
        {activeTab === 'live' && <>

          <div style={s.kpiGrid}>
            <KpiCard label="Speed"           value={t ? `${t.speed}` : '—'}              unit="m/s"  color={C.primary} />
            <KpiCard label="Battery Charge"  value={t ? `${t.battery_percentage}` : '—'} unit="%"    color={battColor} />
            <KpiCard label="Battery Voltage" value={t ? `${t.battery_voltage}` : '—'}    unit="V" />
            <KpiCard label="Steering"        value={t ? (t.current_steering >= 0 ? `+${t.current_steering}` : t.current_steering) : '—'} />
            <KpiCard label="Throttle"        value={t ? `${t.current_throttle}` : '—'}   unit="%"    color={C.success} />
            <SplitKpiCard
              topLabel="Mode"
              topValue={t?.system?.mode ?? (t ? t.mode.toUpperCase() : '—')}
              topColor={t?.system?.mode === 'AUTO' ? C.success : C.text}
              bottomValue={t?.system?.['auto-mode-status'] ?? '—'}
              bottomColor={t?.system?.['auto-mode-status'] === 'single-car' ? C.primary : t?.system?.['auto-mode-status'] === 'multi-car' ? C.warning : C.muted}
            />
            <KpiCard label="Signal"          value={t ? t.signal_quality?.toUpperCase() : '—'} color={signalColor} />
            <KpiCard label="Emergency Stop"  value={t ? (t.emergency_stop ? 'ACTIVE' : 'OFF') : '—'}
              color={t?.emergency_stop ? C.danger : C.success} />
            <KpiCard label="Fail-Safe"       value={t ? (t.fail_safe ? 'ACTIVE' : 'OFF') : '—'}
              color={t?.fail_safe ? C.warning : C.success} />
            <KpiCard label="Motor State"     value={t?.motor_state ?? '—'} color={motorColor} />
          </div>

          <div style={s.chartRow}>
            <Panel title="Live Speed (m/s)" style={{ flex: 1 }}>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="time" tick={{ fill: C.muted, fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: C.muted, fontSize: 10 }} domain={[0, 5]} />
                  <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, fontSize: 12 }} />
                  <Line type="monotone" dataKey="speed" stroke={C.primary} dot={false} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Live Battery (%)" style={{ flex: 1 }}>
              <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 13 }}>
                No data available
              </div>
            </Panel>

            <Panel title="Live Steering (-100 … +100)" style={{ flex: 1 }}>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="time" tick={{ fill: C.muted, fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: C.muted, fontSize: 10 }} domain={[-100, 100]} />
                  <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, fontSize: 12 }} />
                  <Line type="monotone" dataKey="steering" stroke={C.warning} dot={false} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          {t?.sonar || t?.lidar || t?.imu || t?.system ? (
            <div style={{ ...s.chartRow, flexWrap: 'wrap' }}>

              {t?.system && (
                <Panel title="ESP32 System" style={{ flex: 1, minWidth: 200 }}>
                  <SummaryRow label="State"         value={t.system.mstate} />
                  <SummaryRow label="Mode"          value={t.system.mode} />
                  <SummaryRow label="Arm %"         value={`${t.system.armPct}%`} />
                  <SummaryRow label="Disarm Reason" value={t.system.disarmReason} />
                  <SummaryRow label="Emergency"     value={t.system.emergency ? 'YES' : 'NO'} />
                </Panel>
              )}

              {t?.sonar && (
                <Panel title="Sonar" style={{ flex: 1, minWidth: 200 }}>
                  <SummaryRow label="Left (cm)"   value={t.sonar.lCm?.toFixed(1) ?? '—'} />
                  <SummaryRow label="Right (cm)"  value={t.sonar.rCm?.toFixed(1) ?? '—'} />
                  <SummaryRow label="Left Level"  value={`${t.sonar.lLv} / 4`} />
                  <SummaryRow label="Right Level" value={`${t.sonar.rLv} / 4`} />
                  <SummaryRow label="Left Fwd"    value={t.sonar.lFwd?.toFixed(1) ?? '—'} />
                  <SummaryRow label="Right Fwd"   value={t.sonar.rFwd?.toFixed(1) ?? '—'} />
                </Panel>
              )}

              {t?.lidar && (
                <Panel title="Lidar (TF-Luna)" style={{ flex: 1, minWidth: 200 }}>
                  <SummaryRow label="Status"        value={t.lidar.ok ? 'OK' : 'Error'} />
                  <SummaryRow label="Distance (cm)" value={t.lidar.cm >= 0 ? t.lidar.cm?.toFixed(1) : '—'} />
                </Panel>
              )}

              {t?.imu && (
                <Panel title="IMU (MPU6050)" style={{ flex: 1, minWidth: 200 }}>
                  <SummaryRow label="Roll"   value={`${t.imu.roll?.toFixed(2)}°`} />
                  <SummaryRow label="Pitch"  value={`${t.imu.pitch?.toFixed(2)}°`} />
                  <SummaryRow label="Yaw"    value={`${t.imu.yaw?.toFixed(2)}°`} />
                  <SummaryRow label="Temp"   value={`${t.imu.temp?.toFixed(1)} °C`} />
                  <SummaryRow label="Status" value={t.imu.calibrated ? 'Calibrated' : 'Calibrating'} />
                </Panel>
              )}
            </div>
          ) : null}

          <div style={s.bottomRow}>
            <Panel
              title="Race Summary"
              style={{ flex: 1, minWidth: 300 }}
              action={
                <button
                  style={{ ...s.btn, background: C.primaryDark, padding: '4px 14px', fontSize: 12 }}
                  onClick={fetchSummary}
                  disabled={fetching}
                >
                  {fetching ? 'Loading…' : '↻ Fetch'}
                </button>
              }
            >
              {!summary ? (
                <p style={{ color: C.muted, fontSize: 13 }}>Click Fetch to load race data from the backend.</p>
              ) : (
                <>
                  <SummaryRow label="Top Speed"     value={`${summary.top_speed} m/s`} />
                  <SummaryRow label="Average Speed" value={`${summary.average_speed} m/s`} />
                  <SummaryRow label="Sensor Errors" value={`${summary.sensor_error_rate}%`} />
                  <SummaryRow label="Total Packets" value={summary.packet_count} />
                  <div style={{ marginTop: 12 }}>
                    <span style={{ fontSize: 12, color: C.muted }}>Lap Times</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      {summary.lap_times.map((lap, i) => {
                        const best = lap === Math.min(...summary.lap_times)
                        return (
                          <span key={i} style={{
                            padding: '3px 12px', borderRadius: 20, fontSize: 13,
                            fontWeight: best ? 700 : 400,
                            border: `1px solid ${best ? C.success : C.border}`,
                            background: best ? C.success + '33' : C.surfaceAlt,
                            color: best ? C.success : C.text,
                          }}>
                            L{i + 1}: {lap.toFixed(2)}s{best ? ' best' : ''}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </Panel>

            <Panel
              title="Event Log"
              style={{ flex: 1, minWidth: 300 }}
              action={
                <button
                  style={{ ...s.btn, background: C.surfaceAlt, color: C.muted, padding: '4px 14px', fontSize: 12 }}
                  onClick={() => setLogs([])}
                >
                  Clear
                </button>
              }
            >
              <div style={s.logList}>
                {logs.length === 0
                  ? <span style={{ color: C.muted, fontSize: 13 }}>No events yet — connect to start.</span>
                  : logs.map(l => (
                    <div key={l.id} style={s.logEntry}>
                      <span style={s.logTime}>{l.time}</span>
                      <span style={{ color: { success: C.success, warning: C.warning, danger: C.danger }[l.type] ?? C.text }}>
                        {l.msg}
                      </span>
                    </div>
                  ))
                }
              </div>
            </Panel>
          </div>
        </>}

      </main>
    </div>
  )
}

// ── Control Tab ───────────────────────────────────────────────────────────

const OUTER_PX = 260
const KNOB_PX  = 68
const JOY_R    = (OUTER_PX - KNOB_PX) / 2

function ControlTab({ connected, telemetry, sendWs, addLog }) {
  const [steer, setSteer] = useState(0)
  const [thr,   setThr]   = useState(0)

  const joyRef        = useRef(null)
  const knobRef       = useRef(null)
  const activeRef     = useRef(false)
  const heartbeatRef  = useRef(null)
  const curSRef       = useRef(0)
  const curTRef       = useRef(0)
  const canDriveRef   = useRef(false)   // always reflects latest canDrive

  const t         = telemetry
  const mstate    = t?.motor_state ?? '—'
  const emergency = t?.emergency_stop ?? false
  const armed     = mstate === 'ARMED'
  const canDrive  = connected && armed && !emergency

  // Keep ref in sync so callbacks never capture a stale value
  canDriveRef.current = canDrive

  const sendDrive = useCallback((s, th) => {
    sendWs({ type: 'command', steering: Math.round(s), throttle: Math.round(th), mode: 'manual' })
  }, [sendWs])

  const snapCenter = useCallback((send = true) => {
    activeRef.current = false
    clearInterval(heartbeatRef.current)
    heartbeatRef.current = null
    if (knobRef.current) {
      knobRef.current.style.transition = 'transform 0.18s cubic-bezier(.34,1.56,.64,1)'
      knobRef.current.style.transform  = 'translate(-50%,-50%)'
      setTimeout(() => {
        if (knobRef.current) knobRef.current.style.transition = ''
      }, 200)
    }
    curSRef.current = 0
    curTRef.current = 0
    setSteer(0)
    setThr(0)
    if (send && canDriveRef.current) sendDrive(0, 0)
  }, [sendDrive])  // canDriveRef is a ref — stable, no need in deps

  // Release joystick when we lose arm/connect
  useEffect(() => {
    if (!canDrive && activeRef.current) snapCenter(false)
  }, [canDrive, snapCenter])

  // Keyboard control (WASD / arrow keys)
  useEffect(() => {
    const pressed = new Set()

    const update = () => {
      if (!canDriveRef.current) return
      let s = 0, th = 0
      if (pressed.has('ArrowLeft')  || pressed.has('a') || pressed.has('A')) s  = -100
      if (pressed.has('ArrowRight') || pressed.has('d') || pressed.has('D')) s  = +100
      if (pressed.has('ArrowUp')    || pressed.has('w') || pressed.has('W')) th = +100
      if (pressed.has('ArrowDown')  || pressed.has('s') || pressed.has('S')) th = -100
      curSRef.current = s
      curTRef.current = th
      setSteer(s)
      setThr(th)

      // Move knob visually
      if (knobRef.current) {
        const dx = (s / 100) * JOY_R
        const dy = -(th / 100) * JOY_R
        knobRef.current.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
      }
      sendDrive(s, th)
    }

    const onDown = (e) => {
      const relevant = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','a','d','w','s','A','D','W','S']
      if (!relevant.includes(e.key)) return
      e.preventDefault()
      pressed.add(e.key)
      update()
    }
    const onUp = (e) => {
      pressed.delete(e.key)
      if (pressed.size === 0 && activeRef.current === false) snapCenter()
      else if (pressed.size === 0) update()
    }

    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup',   onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup',   onUp)
    }
  }, [sendDrive, snapCenter])  // canDriveRef is a ref — not a dep

  const moveKnob = useCallback((clientX, clientY) => {
    if (!joyRef.current || !knobRef.current) return
    const rect = joyRef.current.getBoundingClientRect()
    const cx   = rect.left + rect.width  / 2
    const cy   = rect.top  + rect.height / 2
    let dx = clientX - cx
    let dy = clientY - cy
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d > JOY_R) { dx = dx / d * JOY_R; dy = dy / d * JOY_R }
    knobRef.current.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
    const s  = Math.round((dx / JOY_R) * 100)
    const th = Math.round((-dy / JOY_R) * 100)
    curSRef.current = s
    curTRef.current = th
    setSteer(s)
    setThr(th)
    sendDrive(s, th)
  }, [sendDrive])

  const onPointerDown = useCallback((e) => {
    if (!canDriveRef.current) return
    activeRef.current = true
    joyRef.current.setPointerCapture(e.pointerId)
    clearInterval(heartbeatRef.current)
    heartbeatRef.current = setInterval(() => sendDrive(curSRef.current, curTRef.current), 200)
    moveKnob(e.clientX, e.clientY)
  }, [moveKnob, sendDrive])

  const onPointerMove = useCallback((e) => {
    if (!activeRef.current) return
    moveKnob(e.clientX, e.clientY)
  }, [moveKnob])

  const motorBadgeStyle = {
    ...s2.motorBadge,
    borderColor: mstate === 'ARMED' ? C.success : mstate === 'EMERGENCY' ? C.danger : C.border,
    background:  mstate === 'ARMED' ? C.success + '22' : mstate === 'EMERGENCY' ? C.danger + '22' : C.surfaceAlt,
    color:       mstate === 'ARMED' ? C.success : mstate === 'EMERGENCY' ? C.danger : C.muted,
  }

  return (
    <div style={s2.wrap}>

      {/* ── Arm / Disarm / State ─────────────────────────────────── */}
      <Panel title="Motor Control">
        <div style={s2.armRow}>
          <button
            style={{ ...s2.armBtn, opacity: (!connected || armed) ? 0.35 : 1, cursor: (!connected || armed) ? 'not-allowed' : 'pointer' }}
            disabled={!connected || armed}
            onClick={() => { sendWs({ type: 'arm' }); addLog('ARM sent', 'info') }}
          >ARM</button>
          <button
            style={{ ...s2.disarmBtn, opacity: !connected ? 0.35 : 1, cursor: !connected ? 'not-allowed' : 'pointer' }}
            disabled={!connected}
            onClick={() => { sendWs({ type: 'disarm' }); addLog('DISARM sent', 'info') }}
          >DISARM</button>
          <button
            style={{ ...s2.armBtn, background: '#e65100', opacity: !connected ? 0.35 : 1, cursor: !connected ? 'not-allowed' : 'pointer' }}
            disabled={!connected}
            onClick={() => { sendWs({ type: 'lap' }); addLog('LAP marked', 'info') }}
          >⏱ LAP</button>
          <span style={motorBadgeStyle}>{mstate}</span>
        </div>
      </Panel>

      {/* ── Run Mode ─────────────────────────────────────────────── */}
      <Panel title="Run Mode">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            style={{ ...s2.armBtn, background: t?.system?.mode === 'MANUAL' ? C.primary : C.surfaceAlt, color: t?.system?.mode === 'MANUAL' ? '#000' : C.muted, opacity: !connected ? 0.35 : 1 }}
            disabled={!connected}
            onClick={() => { sendWs({ type: 'set_mode', mode: 'manual' }); addLog('Mode → MANUAL', 'info') }}
          >MANUAL</button>
          <button
            style={{ ...s2.armBtn, background: t?.system?.mode === 'AUTO' ? C.success : C.surfaceAlt, color: t?.system?.mode === 'AUTO' ? '#000' : C.muted, opacity: !connected ? 0.35 : 1 }}
            disabled={!connected}
            onClick={() => { sendWs({ type: 'set_mode', mode: 'auto' }); addLog('Mode → AUTO', 'info') }}
          >AUTO</button>
          <div style={{ width: 1, height: 28, background: C.border, margin: '0 4px' }} />
          <button
            style={{ ...s2.armBtn, background: t?.system?.['auto-mode-status'] === 'single-car' ? C.warning : C.surfaceAlt, color: t?.system?.['auto-mode-status'] === 'single-car' ? '#000' : C.muted, opacity: !connected ? 0.35 : 1 }}
            disabled={!connected}
            onClick={() => { sendWs({ type: 'set_auto_version', version: 'single' }); addLog('Auto → single-car', 'info') }}
          >SINGLE CAR</button>
          <button
            style={{ ...s2.armBtn, background: t?.system?.['auto-mode-status'] === 'multi-car' ? C.warning : C.surfaceAlt, color: t?.system?.['auto-mode-status'] === 'multi-car' ? '#000' : C.muted, opacity: !connected ? 0.35 : 1 }}
            disabled={!connected}
            onClick={() => { sendWs({ type: 'set_auto_version', version: 'multi' }); addLog('Auto → multi-car', 'info') }}
          >MULTI CAR</button>
          {t?.system && (
            <span style={{ fontSize: 12, color: C.muted, marginLeft: 8 }}>
              {t.system.mode ?? '—'} · {t.system['auto-mode-status'] ?? '—'}
            </span>
          )}
        </div>
      </Panel>

      {/* ── Joystick ─────────────────────────────────────────────── */}
      <Panel title="Joystick — drag or use WASD / arrow keys">
        <div style={s2.joySection}>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <span style={{ ...s2.dirLbl, top: -20, left: '50%', transform: 'translateX(-50%)' }}>▲ Forward</span>
            <span style={{ ...s2.dirLbl, bottom: -20, left: '50%', transform: 'translateX(-50%)' }}>▼ Reverse</span>
            <span style={{ ...s2.dirLbl, left: -30, top: '50%', transform: 'translateY(-50%)' }}>◀ L</span>
            <span style={{ ...s2.dirLbl, right: -30, top: '50%', transform: 'translateY(-50%)' }}>R ▶</span>

            <div
              ref={joyRef}
              style={{
                ...s2.joyOuter,
                opacity:        canDrive ? 1 : 0.38,
                cursor:         canDrive ? 'crosshair' : 'not-allowed',
                pointerEvents:  canDrive ? 'auto' : 'none',
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => snapCenter()}
              onPointerCancel={() => snapCenter(false)}
            >
              <div style={s2.crossH} />
              <div style={s2.crossV} />
              <div
                ref={knobRef}
                style={{
                  ...s2.joyKnob,
                  borderColor: activeRef.current ? C.primary : C.border,
                  background:  activeRef.current ? C.primaryDark : '#1e1e1e',
                }}
              />
            </div>
          </div>

          {/* Values */}
          <div style={s2.valBlock}>
            <div style={s2.valBox}>
              <div style={s2.valLabel}>Steering</div>
              <div style={{ ...s2.valNum, color: steer !== 0 ? C.primary : C.muted }}>
                {steer > 0 ? '+' : ''}{steer}
              </div>
            </div>
            <div style={s2.valSep} />
            <div style={s2.valBox}>
              <div style={s2.valLabel}>Throttle</div>
              <div style={{ ...s2.valNum, color: thr > 0 ? C.success : thr < 0 ? C.danger : C.muted }}>
                {thr > 0 ? '+' : ''}{thr}
              </div>
            </div>
            <div style={s2.valSep} />
            <div style={s2.valBox}>
              <div style={s2.valLabel}>Speed</div>
              <div style={{ ...s2.valNum, color: C.primary }}>
                {t?.speed ?? '—'}<span style={{ fontSize: 13, color: C.muted }}> m/s</span>
              </div>
            </div>
          </div>
        </div>
        {!connected && (
          <p style={{ color: C.muted, fontSize: 13, marginTop: 12 }}>
            Connect to backend first (header Connect button).
          </p>
        )}
        {connected && !armed && !emergency && (
          <p style={{ color: C.warning, fontSize: 13, marginTop: 12 }}>
            ARM the car to enable joystick control.
          </p>
        )}
      </Panel>

      {/* ── Emergency Stop ─────────────────────────────────────────── */}
      <button
        style={{
          ...s2.estopBtn,
          opacity:    !connected ? 0.35 : 1,
          cursor:     !connected ? 'not-allowed' : 'pointer',
          background: emergency ? '#7d1f1f' : C.danger,
          border:     emergency ? `2px solid ${C.danger}` : 'none',
        }}
        disabled={!connected}
        onClick={() => { sendWs({ type: 'emergency_stop' }); addLog('EMERGENCY STOP sent', 'danger') }}
      >
        {emergency ? 'EMERGENCY STOP ACTIVE' : 'EMERGENCY STOP'}
      </button>

      {emergency && (
        <button
          style={s2.resetBtn}
          onClick={() => { sendWs({ type: 'reset_emergency_stop' }); addLog('Emergency stop reset', 'success') }}
        >
          Reset Emergency Stop
        </button>
      )}

      {/* ── Live sensor snapshot ────────────────────────────────────── */}
      {t && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {t.sonar && (
            <Panel title="Sonar" style={{ flex: 1, minWidth: 180 }}>
              <SummaryRow label="Left"  value={`${t.sonar.lCm?.toFixed(0) ?? '—'} cm (lv ${t.sonar.lLv})`} />
              <SummaryRow label="Right" value={`${t.sonar.rCm?.toFixed(0) ?? '—'} cm (lv ${t.sonar.rLv})`} />
            </Panel>
          )}
          {t.lidar && (
            <Panel title="Lidar" style={{ flex: 1, minWidth: 160 }}>
              <SummaryRow label="Distance" value={`${t.lidar.cm?.toFixed(0) ?? '—'} cm`} />
              <SummaryRow label="Status"   value={t.lidar.ok ? 'OK' : 'Error'} />
            </Panel>
          )}
          {t.imu && (
            <Panel title="IMU" style={{ flex: 1, minWidth: 200 }}>
              <SummaryRow label="Roll"  value={`${t.imu.roll?.toFixed(1)}°`} />
              <SummaryRow label="Pitch" value={`${t.imu.pitch?.toFixed(1)}°`} />
              <SummaryRow label="Yaw"   value={`${t.imu.yaw?.toFixed(1)}°`} />
            </Panel>
          )}
        </div>
      )}
    </div>
  )
}

// ── History Tab ───────────────────────────────────────────────────────────

function HistoryTab({ sessions, loading, influxEnabled, onRefresh, onSelectSession, selectedSession, sessionData, loadingSession }) {
  const fmtTime = (iso) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('tr-TR', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }
  const fmtDuration = (secs) => {
    if (!secs) return '—'
    const m = Math.floor(secs / 60), s = secs % 60
    return m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 18, fontWeight: 700 }}>Race History</span>
        <button
          style={{ ...s.btn, background: C.primaryDark, padding: '5px 16px', fontSize: 13 }}
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
        {influxEnabled === false && (
          <span style={{ fontSize: 13, color: C.warning }}>
            InfluxDB not configured — set INFLUXDB_TOKEN in start.sh
          </span>
        )}
        {influxEnabled === true && sessions.length === 0 && !loading && (
          <span style={{ fontSize: 13, color: C.muted }}>No sessions recorded yet.</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {sessions.length > 0 && (
          <Panel title="Sessions (last 30 days)" style={{ minWidth: 300, flex: '0 0 300px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sessions.map(sess => (
                <div
                  key={sess.session_id}
                  style={{
                    padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                    border: `1px solid ${selectedSession === sess.session_id ? C.primary : C.border}`,
                    background: selectedSession === sess.session_id ? C.primary + '18' : C.surfaceAlt,
                  }}
                  onClick={() => onSelectSession(sess.session_id)}
                >
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 2 }}>{sess.car_id}</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{fmtTime(sess.start_time)}</div>
                  <div style={{ fontSize: 11, color: C.primary, marginTop: 2 }}>{sess.session_id}</div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {selectedSession && (
          <div style={{ flex: 1, minWidth: 400 }}>
            {loadingSession ? (
              <Panel title="Loading session…"><p style={{ color: C.muted, fontSize: 13 }}>Fetching…</p></Panel>
            ) : sessionData?.error ? (
              <Panel title="Error"><p style={{ color: C.danger, fontSize: 13 }}>{sessionData.error}</p></Panel>
            ) : sessionData ? (
              <>
                <div style={{ ...s.kpiGrid, marginBottom: 16 }}>
                  <KpiCard label="Top Speed"     value={sessionData.stats?.top_speed ?? '—'}     unit="m/s" color={C.primary} />
                  <KpiCard label="Avg Speed"      value={sessionData.stats?.average_speed ?? '—'} unit="m/s" />
                  <KpiCard label="Duration"       value={fmtDuration(sessionData.stats?.duration_s)} />
                  <KpiCard label="Data Points"    value={sessionData.stats?.data_points ?? '—'} />
                  <KpiCard label="Sensor Errors"  value={sessionData.stats?.sensor_error_rate != null ? `${sessionData.stats.sensor_error_rate}%` : '—'}
                    color={sessionData.stats?.sensor_error_rate > 5 ? C.danger : C.success} />
                </div>

                {sessionData.speed_series?.length > 0 && (
                  <Panel title="Speed (m/s)" style={{ marginBottom: 16 }}>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart
                        data={sessionData.speed_series.map(p => ({ ...p, label: new Date(p.time * 1000).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) }))}
                        margin={{ top: 4, right: 8, bottom: 0, left: -20 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                        <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fill: C.muted, fontSize: 10 }} domain={[0, 5]} />
                        <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, fontSize: 12 }} />
                        <Line type="monotone" dataKey="speed" stroke={C.primary} dot={false} strokeWidth={2} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </Panel>
                )}

                {sessionData.steering_series?.length > 0 && (
                  <Panel title="Steering (-100 … +100)" style={{ marginBottom: 16 }}>
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart
                        data={sessionData.steering_series.map(p => ({ ...p, label: new Date(p.time * 1000).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) }))}
                        margin={{ top: 4, right: 8, bottom: 0, left: -20 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                        <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fill: C.muted, fontSize: 10 }} domain={[-100, 100]} />
                        <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, fontSize: 12 }} />
                        <Line type="monotone" dataKey="steering" stroke={C.warning} dot={false} strokeWidth={2} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </Panel>
                )}

                {sessionData.battery_series?.length > 0 && (
                  <Panel title="Battery (%)">
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart
                        data={sessionData.battery_series.map(p => ({ ...p, label: new Date(p.time * 1000).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) }))}
                        margin={{ top: 4, right: 8, bottom: 0, left: -20 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                        <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fill: C.muted, fontSize: 10 }} domain={[0, 100]} />
                        <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, fontSize: 12 }} />
                        <Line type="monotone" dataKey="battery" stroke={C.success} dot={false} strokeWidth={2} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </Panel>
                )}
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Reusable components ───────────────────────────────────────────────────

function SplitKpiCard({ topLabel, topValue, topColor, bottomValue, bottomColor }) {
  return (
    <div style={{ ...s.kpiCard, justifyContent: 'center' }}>
      <span style={{ fontSize: 24, fontWeight: 700, color: topColor ?? C.text }}>{topValue}</span>
      <span style={{ fontSize: 11, color: C.muted }}>{topLabel}</span>
      <div style={{ width: '100%', height: 1, background: C.border, margin: '5px 0' }} />
      <span style={{ fontSize: 13, fontWeight: 600, color: bottomColor ?? C.muted }}>{bottomValue ?? '—'}</span>
    </div>
  )
}

function KpiCard({ label, value, unit, color }) {
  return (
    <div style={s.kpiCard}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: color ?? C.text }}>{value}</span>
        {unit && <span style={{ fontSize: 12, color: C.muted }}>{unit}</span>}
      </div>
      <span style={{ fontSize: 11, color: C.muted, textAlign: 'center' }}>{label}</span>
    </div>
  )
}

function Panel({ title, children, style, action }) {
  return (
    <div style={{ ...s.panel, ...style }}>
      <div style={s.panelHeader}>
        <span style={s.panelTitle}>{title}</span>
        {action}
      </div>
      {children}
    </div>
  )
}

function SummaryRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 13, color: C.muted }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{value}</span>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────

const s = {
  app: { minHeight: '100vh', background: C.bg, color: C.text },
  header: {
    background: C.surface, borderBottom: `1px solid ${C.border}`,
    padding: '12px 24px', display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', flexWrap: 'wrap', gap: 12,
  },
  headerLeft:  { display: 'flex', alignItems: 'center', gap: 12 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 8 },
  logo:  { fontSize: 20, fontWeight: 700 },
  badge: { fontSize: 13, fontWeight: 600, padding: '3px 12px', borderRadius: 20, border: '1px solid' },
  urlInput: {
    background: C.surfaceAlt, border: `1px solid ${C.border}`,
    borderRadius: 6, color: C.text, padding: '6px 12px',
    fontSize: 13, width: 300, outline: 'none',
  },
  btn: { borderRadius: 6, padding: '6px 18px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', color: '#fff' },
  banner: { padding: '10px 24px', borderBottom: '2px solid', fontWeight: 700, fontSize: 14, textAlign: 'center' },
  main:   { padding: 20 },
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: 12, marginBottom: 20,
  },
  kpiCard: {
    background: C.surface, border: `1px solid ${C.border}`,
    borderRadius: 10, padding: '16px 12px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
  },
  chartRow:  { display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' },
  bottomRow: { display: 'flex', gap: 16, flexWrap: 'wrap' },
  panel: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 },
  panelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  panelTitle:  { fontSize: 15, fontWeight: 600 },
  tabBar: {
    display: 'flex', gap: 0,
    borderBottom: `1px solid ${C.border}`,
    background: C.surface, paddingLeft: 24,
  },
  tabBtn: { padding: '10px 24px', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', transition: 'color 0.15s' },
  logList:  { maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 },
  logEntry: { display: 'flex', gap: 10, padding: '3px 0', borderBottom: `1px solid ${C.border}44`, fontSize: 12, fontFamily: 'monospace' },
  logTime:  { color: C.muted, flexShrink: 0, width: 80 },
}

// Control tab-specific styles
const s2 = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 700 },

  armRow: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  armBtn: {
    padding: '9px 32px', borderRadius: 8, border: 'none',
    cursor: 'pointer', fontSize: 14, fontWeight: 700,
    color: '#000', background: C.success,
  },
  disarmBtn: {
    padding: '9px 32px', borderRadius: 8,
    border: `1px solid ${C.border}`, cursor: 'pointer',
    fontSize: 14, fontWeight: 700,
    color: C.muted, background: C.surfaceAlt,
  },
  motorBadge: {
    padding: '5px 18px', borderRadius: 99,
    fontSize: 12, fontWeight: 700, letterSpacing: 1,
    border: '1px solid',
  },

  joySection: { display: 'flex', alignItems: 'center', gap: 48, flexWrap: 'wrap', paddingTop: 28, paddingBottom: 12 },
  joyOuter: {
    width: OUTER_PX, height: OUTER_PX, borderRadius: '50%',
    background: '#111', border: `2px solid ${C.border}`,
    position: 'relative', touchAction: 'none', userSelect: 'none',
  },
  crossH: { position: 'absolute', top: '50%', left: 0, width: '100%', height: 1, background: '#222', transform: 'translateY(-50%)' },
  crossV: { position: 'absolute', left: '50%', top: 0, width: 1, height: '100%', background: '#222', transform: 'translateX(-50%)' },
  joyKnob: {
    position: 'absolute', width: KNOB_PX, height: KNOB_PX, borderRadius: '50%',
    top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
    pointerEvents: 'none', boxShadow: '0 4px 12px rgba(0,0,0,.6)',
    border: `2px solid ${C.border}`, background: '#1e1e1e',
  },
  dirLbl: { position: 'absolute', fontSize: 11, fontWeight: 600, color: C.muted, pointerEvents: 'none', whiteSpace: 'nowrap' },

  valBlock: { display: 'flex', alignItems: 'center', gap: 24 },
  valBox:   { textAlign: 'center', minWidth: 80 },
  valLabel: { fontSize: 10, color: C.muted, letterSpacing: 1, textTransform: 'uppercase' },
  valNum:   { fontSize: 32, fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  valSep:   { width: 1, height: 44, background: C.border },

  estopBtn: {
    padding: '16px', border: 'none', borderRadius: 12,
    color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer',
    letterSpacing: 1,
  },
  resetBtn: {
    padding: '10px', borderRadius: 10,
    border: `1px solid ${C.success}`, background: C.surfaceAlt,
    color: C.success, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
}
