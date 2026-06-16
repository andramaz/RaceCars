/**
 * App.jsx — RC Car Web Dashboard
 *
 * Connects to the same FastAPI backend as the mobile app via WebSocket.
 * Shows live telemetry, live charts, race summary, and an event log.
 *
 * Run with:  npm run dev   (inside the dashboard/ folder)
 * Open at:   http://localhost:5173
 */

import React, { useState, useRef, useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

// ── Design tokens (matches mobile app dark theme) ─────────────────────────

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

// Keep the last 60 telemetry ticks in the live chart (= 30 seconds at 500 ms).
const MAX_POINTS = 60

// ── Root component ────────────────────────────────────────────────────────

export default function App() {
  const [wsUrl,     setWsUrl]     = useState('ws://192.168.1.165:8000/ws')
  const [connected, setConnected] = useState(false)
  const [telemetry, setTelemetry] = useState(null)
  const [chartData, setChartData] = useState([])   // live rolling buffer
  const [logs,      setLogs]      = useState([])
  const [summary,   setSummary]   = useState(null)
  const [fetching,  setFetching]  = useState(false)

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [activeTab,       setActiveTab]       = useState('live')
  const [sessions,        setSessions]        = useState([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [influxEnabled,   setInfluxEnabled]   = useState(null)
  const [selectedSession, setSelectedSession] = useState(null)
  const [sessionData,     setSessionData]     = useState(null)
  const [loadingSession,  setLoadingSession]  = useState(false)

  const wsRef            = useRef(null)
  const prevEmergencyRef = useRef(false)
  const prevFailSafeRef  = useRef(false)

  // ── Log helper ───────────────────────────────────────────────────────────

  const addLog = useCallback((msg, type = 'info') => {
    setLogs(prev => [{
      id:   Date.now() + Math.random(),
      time: new Date().toLocaleTimeString(),
      msg,
      type, // 'info' | 'success' | 'warning' | 'danger'
    }, ...prev].slice(0, 120))
  }, [])

  // ── WebSocket ─────────────────────────────────────────────────────────────

  const connect = () => {
    if (wsRef.current) wsRef.current.close()
    addLog(`Connecting to ${wsUrl}…`)

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      addLog(`Connected to ${wsUrl}`, 'success')
    }

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data)
      if (data.type !== 'telemetry') return

      setTelemetry(data)

      // Append one point to the rolling chart buffer.
      const label = new Date().toLocaleTimeString('en', {
        hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
      setChartData(prev => [
        ...prev.slice(-(MAX_POINTS - 1)),
        { time: label, speed: data.speed, battery: data.battery_percentage, steering: data.current_steering },
      ])

      // Log safety state transitions only (not every tick).
      if (data.emergency_stop && !prevEmergencyRef.current)
        addLog('🛑 EMERGENCY STOP activated', 'danger')
      if (!data.emergency_stop && prevEmergencyRef.current)
        addLog('Emergency stop cleared', 'success')
      prevEmergencyRef.current = data.emergency_stop

      if (data.fail_safe && !prevFailSafeRef.current)
        addLog('⚠ FAIL-SAFE activated — no commands received', 'warning')
      if (!data.fail_safe && prevFailSafeRef.current)
        addLog('Fail-safe cleared', 'success')
      prevFailSafeRef.current = data.fail_safe
    }

    ws.onerror  = () => { addLog('WebSocket error', 'danger'); setConnected(false) }
    ws.onclose  = () => { setConnected(false); setTelemetry(null); addLog('Disconnected') }
  }

  const disconnect = () => { wsRef.current?.close(); wsRef.current = null }

  // ── Race summary (REST) ──────────────────────────────────────────────────

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

  // ── History tab helpers ───────────────────────────────────────────────────

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
          <span style={s.logo}>🏎  RC Car Dashboard</span>
          <span style={{ ...s.badge, color: connected ? C.success : C.danger, borderColor: connected ? C.success : C.danger, background: (connected ? C.success : C.danger) + '22' }}>
            {connected ? '● Connected' : '○ Disconnected'}
          </span>
        </div>
        <div style={s.headerRight}>
          <input
            style={s.urlInput}
            value={wsUrl}
            onChange={e => setWsUrl(e.target.value)}
            placeholder="ws://192.168.1.165:8000/ws"
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
        {['live', 'history'].map(tab => (
          <button
            key={tab}
            style={{
              ...s.tabBtn,
              color:       activeTab === tab ? C.primary       : C.muted,
              borderBottom: activeTab === tab ? `2px solid ${C.primary}` : '2px solid transparent',
              background:  'none',
            }}
            onClick={() => { setActiveTab(tab); if (tab === 'history' && sessions.length === 0) fetchSessions() }}
          >
            {tab === 'live' ? '● Live' : '◷ History'}
          </button>
        ))}
      </div>

      {/* ── Safety banners (live only) ──────────────────────────────────── */}
      {activeTab === 'live' && t?.emergency_stop && (
        <div style={{ ...s.banner, borderColor: C.danger, background: C.danger + '22', color: C.danger }}>
          🛑  EMERGENCY STOP IS ACTIVE — throttle is locked at 0
        </div>
      )}
      {activeTab === 'live' && t?.fail_safe && (
        <div style={{ ...s.banner, borderColor: C.warning, background: C.warning + '22', color: C.warning }}>
          ⚠  FAIL-SAFE ACTIVE — backend received no command for &gt;1 s
        </div>
      )}

      <main style={s.main}>

        {/* ══════════════════════════════════════════════════════════════════
            HISTORY TAB
        ═══════════════════════════════════════════════════════════════════ */}
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

        {/* ══════════════════════════════════════════════════════════════════
            LIVE TAB
        ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'live' && <>

        {/* ── KPI cards ──────────────────────────────────────────────────── */}
        <div style={s.kpiGrid}>
          <KpiCard label="Speed"          value={t ? `${t.speed}` : '—'}              unit="m/s"  color={C.primary} />
          <KpiCard label="Battery Charge" value={t ? `${t.battery_percentage}` : '—'} unit="%"    color={battColor} />
          <KpiCard label="Battery Voltage"value={t ? `${t.battery_voltage}` : '—'}    unit="V" />
          <KpiCard label="Steering"       value={t ? (t.current_steering >= 0 ? `+${t.current_steering}` : t.current_steering) : '—'} />
          <KpiCard label="Throttle"       value={t ? `${t.current_throttle}` : '—'}   unit="%"    color={C.success} />
          <KpiCard label="Mode"           value={t ? t.mode.toUpperCase() : '—'} />
          <KpiCard label="Signal"         value={t ? t.signal_quality?.toUpperCase() : '—'} color={signalColor} />
          <KpiCard label="Emergency Stop" value={t ? (t.emergency_stop ? 'ACTIVE' : 'OFF') : '—'}
            color={t?.emergency_stop ? C.danger : C.success} />
          <KpiCard label="Fail-Safe"      value={t ? (t.fail_safe ? 'ACTIVE' : 'OFF') : '—'}
            color={t?.fail_safe ? C.warning : C.success} />
          <KpiCard label="Motor State"    value={t?.motor_state ?? '—'} color={motorColor} />
        </div>

        {/* ── Live charts ────────────────────────────────────────────────── */}
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
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="time" tick={{ fill: C.muted, fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: C.muted, fontSize: 10 }} domain={[0, 100]} />
                <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, fontSize: 12 }} />
                <Line type="monotone" dataKey="battery" stroke={C.success} dot={false} strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
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

        {/* ── ESP32 Sensor Data ──────────────────────────────────────────── */}
        {t?.sonar || t?.lidar || t?.imu || t?.system ? (
          <div style={{ ...s.chartRow, flexWrap: 'wrap' }}>

            {/* System State */}
            {t?.system && (
              <Panel title="ESP32 System" style={{ flex: 1, minWidth: 200 }}>
                <SummaryRow label="State"   value={t.system.mstate} />
                <SummaryRow label="Mode"    value={t.system.mode} />
                <SummaryRow label="Arm %"   value={`${t.system.armPct}%`} />
                <SummaryRow label="Disarm Reason" value={t.system.disarmReason} />
                <SummaryRow label="Emergency"     value={t.system.emergency ? '🛑 YES' : 'NO'} />
              </Panel>
            )}

            {/* Sonar */}
            {t?.sonar && (
              <Panel title="Sonar" style={{ flex: 1, minWidth: 200 }}>
                <SummaryRow label="Left (cm)"    value={t.sonar.lCm?.toFixed(1) ?? '—'} />
                <SummaryRow label="Right (cm)"   value={t.sonar.rCm?.toFixed(1) ?? '—'} />
                <SummaryRow label="Left Level"   value={`${t.sonar.lLv} / 4`} />
                <SummaryRow label="Right Level"  value={`${t.sonar.rLv} / 4`} />
                <SummaryRow label="Left Fwd"     value={t.sonar.lFwd?.toFixed(1) ?? '—'} />
                <SummaryRow label="Right Fwd"    value={t.sonar.rFwd?.toFixed(1) ?? '—'} />
              </Panel>
            )}

            {/* Lidar */}
            {t?.lidar && (
              <Panel title="Lidar (TF-Luna)" style={{ flex: 1, minWidth: 200 }}>
                <SummaryRow label="Status"       value={t.lidar.ok ? '✅ OK' : '❌ Error'} />
                <SummaryRow label="Distance (cm)" value={t.lidar.cm >= 0 ? t.lidar.cm?.toFixed(1) : '—'} />
              </Panel>
            )}

            {/* IMU */}
            {t?.imu && (
              <Panel title="IMU (MPU6050)" style={{ flex: 1, minWidth: 200 }}>
                <SummaryRow label="Roll"   value={`${t.imu.roll?.toFixed(2)}°`} />
                <SummaryRow label="Pitch"  value={`${t.imu.pitch?.toFixed(2)}°`} />
                <SummaryRow label="Yaw"    value={`${t.imu.yaw?.toFixed(2)}°`} />
                <SummaryRow label="Temp"   value={`${t.imu.temp?.toFixed(1)} °C`} />
                <SummaryRow label="Status" value={t.imu.calibrated ? '✅ Calibrated' : '⏳ Calibrating'} />
              </Panel>
            )}

          </div>
        ) : null}

        {/* ── Race summary + Event log ────────────────────────────────────── */}
        <div style={s.bottomRow}>

          {/* Race summary */}
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
              <p style={{ color: C.muted, fontSize: 13 }}>
                Click Fetch to load race data from the backend.
              </p>
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
                          L{i + 1}: {lap.toFixed(2)}s{best ? ' 🏆' : ''}
                        </span>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </Panel>

          {/* Event log */}
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

// ── History tab component ─────────────────────────────────────────────────

function HistoryTab({
  sessions, loading, influxEnabled, onRefresh,
  onSelectSession, selectedSession, sessionData, loadingSession,
}) {
  const fmtTime = (iso) => {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleString('tr-TR', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const fmtDuration = (secs) => {
    if (!secs) return '—'
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  return (
    <div>
      {/* ── Header row ─────────────────────────────────────────────────── */}
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
            ⚠ InfluxDB not configured — set INFLUXDB_TOKEN in start.ps1
          </span>
        )}
        {influxEnabled === true && sessions.length === 0 && !loading && (
          <span style={{ fontSize: 13, color: C.muted }}>No sessions recorded yet.</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>

        {/* ── Session list ────────────────────────────────────────────────── */}
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
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 2 }}>
                    {sess.car_id}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {fmtTime(sess.start_time)}
                  </div>
                  <div style={{ fontSize: 11, color: C.primary, marginTop: 2 }}>
                    {sess.session_id}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* ── Session detail ───────────────────────────────────────────────── */}
        {selectedSession && (
          <div style={{ flex: 1, minWidth: 400 }}>
            {loadingSession ? (
              <Panel title="Loading session…">
                <p style={{ color: C.muted, fontSize: 13 }}>Fetching data from InfluxDB…</p>
              </Panel>
            ) : sessionData?.error ? (
              <Panel title="Error">
                <p style={{ color: C.danger, fontSize: 13 }}>{sessionData.error}</p>
              </Panel>
            ) : sessionData ? (
              <>
                {/* Stats row */}
                <div style={{ ...s.kpiGrid, marginBottom: 16 }}>
                  <KpiCard label="Top Speed"    value={sessionData.stats?.top_speed ?? '—'}     unit="m/s" color={C.primary} />
                  <KpiCard label="Avg Speed"    value={sessionData.stats?.average_speed ?? '—'} unit="m/s" />
                  <KpiCard label="Duration"     value={fmtDuration(sessionData.stats?.duration_s)} />
                  <KpiCard label="Data Points"  value={sessionData.stats?.data_points ?? '—'} />
                  <KpiCard label="Sensor Errors" value={sessionData.stats?.sensor_error_rate != null ? `${sessionData.stats.sensor_error_rate}%` : '—'} color={sessionData.stats?.sensor_error_rate > 5 ? C.danger : C.success} />
                </div>

                {/* Speed chart */}
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

                {/* Battery chart */}
                {sessionData.battery_series?.length > 0 && (
                  <Panel title="Battery (%)" style={{ marginBottom: 16 }}>
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

                {/* Steering chart */}
                {sessionData.steering_series?.length > 0 && (
                  <Panel title="Steering (-100 … +100)">
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
              </>
            ) : null}
          </div>
        )}

      </div>
    </div>
  )
}

// ── Reusable components ───────────────────────────────────────────────────

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
  logo: { fontSize: 20, fontWeight: 700 },
  badge: {
    fontSize: 13, fontWeight: 600,
    padding: '3px 12px', borderRadius: 20, border: '1px solid',
  },
  urlInput: {
    background: C.surfaceAlt, border: `1px solid ${C.border}`,
    borderRadius: 6, color: C.text, padding: '6px 12px',
    fontSize: 13, width: 300, outline: 'none',
  },
  btn: {
    borderRadius: 6, padding: '6px 18px', fontSize: 13,
    fontWeight: 600, border: 'none', cursor: 'pointer', color: '#fff',
  },

  banner: {
    padding: '10px 24px', borderBottom: '2px solid',
    fontWeight: 700, fontSize: 14, textAlign: 'center',
  },

  main: { padding: 20 },

  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: 12, marginBottom: 20,
  },
  kpiCard: {
    background: C.surface, border: `1px solid ${C.border}`,
    borderRadius: 10, padding: '16px 12px',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 6,
  },

  chartRow:  { display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' },
  bottomRow: { display: 'flex', gap: 16, flexWrap: 'wrap' },

  panel: {
    background: C.surface, border: `1px solid ${C.border}`,
    borderRadius: 10, padding: 16,
  },
  panelHeader: {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 12,
  },
  panelTitle: { fontSize: 15, fontWeight: 600 },

  tabBar: {
    display: 'flex', gap: 0,
    borderBottom: `1px solid ${C.border}`,
    background: C.surface, paddingLeft: 24,
  },
  tabBtn: {
    padding: '10px 24px', fontSize: 14, fontWeight: 600,
    border: 'none', cursor: 'pointer',
    transition: 'color 0.15s',
  },

  logList: { maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 },
  logEntry: {
    display: 'flex', gap: 10, padding: '3px 0',
    borderBottom: `1px solid ${C.border}44`,
    fontSize: 12, fontFamily: 'monospace',
  },
  logTime: { color: C.muted, flexShrink: 0, width: 80 },
}
