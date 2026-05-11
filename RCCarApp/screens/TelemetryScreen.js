/**
 * TelemetryScreen.js
 *
 * Displays the real-time telemetry snapshot most recently received from
 * the backend WebSocket.  Updates automatically whenever new data arrives
 * because it reads from AppContext state.
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useApp } from '../context/AppContext';
import { colors, spacing, card } from '../styles/theme';

// ── Reusable row component ────────────────────────────────────────────────

function Row({ label, value, unit, valueColor }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]}>
        {value}
        {unit ? <Text style={styles.rowUnit}>  {unit}</Text> : null}
      </Text>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────

export default function TelemetryScreen() {
  const { telemetry, connected, lastUpdate } = useApp();

  // Colour helper for signal quality label.
  const signalColor = (q) =>
    ({ good: colors.success, medium: colors.warning, poor: colors.danger }[q] ?? colors.textMuted);

  // Colour helper for battery percentage.
  const battColor = (pct) => {
    if (pct > 50) return colors.success;
    if (pct > 20) return colors.warning;
    return colors.danger;
  };

  // ── Not connected ──────────────────────────────────────────────────────
  if (!connected) {
    return (
      <View style={styles.centered}>
        <Text style={styles.bigIcon}>📡</Text>
        <Text style={styles.emptyTitle}>Not connected</Text>
        <Text style={styles.emptyHint}>Go to the Connection tab to connect.</Text>
      </View>
    );
  }

  // ── Waiting for first packet ───────────────────────────────────────────
  if (!telemetry) {
    return (
      <View style={styles.centered}>
        <Text style={styles.bigIcon}>⏳</Text>
        <Text style={styles.emptyTitle}>Waiting for telemetry…</Text>
      </View>
    );
  }

  // ── Live telemetry ────────────────────────────────────────────────────
  const t = telemetry;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>Live Telemetry</Text>
      <Text style={styles.subtitle}>Last update: {lastUpdate}</Text>

      {/* Safety alerts — shown only when active */}
      {t.emergency_stop && (
        <View style={[styles.alert, styles.alertDanger]}>
          <Text style={styles.alertText}>🛑  EMERGENCY STOP ACTIVE</Text>
        </View>
      )}
      {t.fail_safe && (
        <View style={[styles.alert, styles.alertWarning]}>
          <Text style={styles.alertText}>⚠  FAIL-SAFE ACTIVE — no commands received</Text>
        </View>
      )}

      {/* ── Motion ─────────────────────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Motion</Text>
        <Row label="Speed"     value={t.speed}             unit="m/s" />
        <Row label="Steering"  value={t.current_steering} />
        <Row label="Throttle"  value={t.current_throttle}  unit="%" />
        <Row label="Mode"      value={t.mode.toUpperCase()} />
      </View>

      {/* ── Battery ────────────────────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Battery</Text>
        <Row
          label="Charge"
          value={t.battery_percentage}
          unit="%"
          valueColor={battColor(t.battery_percentage)}
        />
        <Row label="Voltage" value={t.battery_voltage} unit="V" />
      </View>

      {/* ── Connection ─────────────────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Connection</Text>
        <Row
          label="Signal"
          value={(t.signal_quality || '—').toUpperCase()}
          valueColor={signalColor(t.signal_quality)}
        />
        <Row label="Car ID"    value={t.car_id} />
        <Row label="Timestamp" value={new Date(t.timestamp * 1000).toLocaleTimeString()} />
      </View>

      {/* ── Safety ─────────────────────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Safety</Text>
        <Row
          label="Emergency Stop"
          value={t.emergency_stop ? 'ACTIVE' : 'OFF'}
          valueColor={t.emergency_stop ? colors.danger : colors.success}
        />
        <Row
          label="Fail-Safe"
          value={t.fail_safe ? 'ACTIVE' : 'OFF'}
          valueColor={t.fail_safe ? colors.warning : colors.success}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:       { flex: 1, backgroundColor: colors.background },
  scroll:     { padding: spacing.md },
  centered:   { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' },
  bigIcon:    { fontSize: 52, marginBottom: spacing.md },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  emptyHint:  { fontSize: 13, color: colors.textMuted },

  title:    { fontSize: 24, fontWeight: 'bold', color: colors.text, marginBottom: 2 },
  subtitle: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.md },

  alert: {
    borderRadius:    8,
    padding:         spacing.sm,
    marginBottom:    spacing.sm,
    borderWidth:     1,
    alignItems:      'center',
  },
  alertDanger:  { backgroundColor: colors.danger  + '22', borderColor: colors.danger },
  alertWarning: { backgroundColor: colors.warning + '22', borderColor: colors.warning },
  alertText:    { fontWeight: '600', color: colors.text },

  card:      { ...card },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },

  row: {
    flexDirection:   'row',
    justifyContent:  'space-between',
    alignItems:      'center',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLabel: { fontSize: 14, color: colors.textMuted },
  rowValue: { fontSize: 14, fontWeight: '600', color: colors.text },
  rowUnit:  { fontSize: 11, color: colors.textMuted, fontWeight: 'normal' },
});
