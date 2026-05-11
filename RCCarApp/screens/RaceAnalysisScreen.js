/**
 * RaceAnalysisScreen.js
 *
 * Fetches /api/race-summary from the backend (HTTP, not WebSocket)
 * and renders KPI cards, lap times, a speed chart, and a battery chart.
 *
 * Charts require:  react-native-chart-kit  +  react-native-svg
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { useApp } from '../context/AppContext';
import { colors, spacing, card } from '../styles/theme';

const SCREEN_WIDTH = Dimensions.get('window').width;
// Chart fills the screen minus padding and card borders.
const CHART_W = SCREEN_WIDTH - spacing.md * 2 - spacing.md * 2 - 2;

// ── KPI card ────────────────────────────────────────────────────────────────

function KpiCard({ value, label, valueColor }) {
  return (
    <View style={styles.kpiCard}>
      <Text style={[styles.kpiValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function RaceAnalysisScreen() {
  const { wsUrl } = useApp();

  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const fetchSummary = async () => {
    setLoading(true);
    setError(null);

    try {
      // Convert ws://host:port/ws  →  http://host:port
      const httpBase = wsUrl
        .replace(/^ws:\/\//, 'http://')
        .replace(/\/ws$/, '');

      const res = await fetch(`${httpBase}/api/race-summary`);
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);

      const data = await res.json();
      setSummary(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Auto-load when the screen mounts.
  useEffect(() => { fetchSummary(); }, []);

  // Shared chart configuration (dark theme).
  const chartCfg = {
    backgroundColor:          colors.surface,
    backgroundGradientFrom:   colors.surface,
    backgroundGradientTo:     colors.surface,
    decimalPlaces:            1,
    color:                    (o = 1) => `rgba(88, 166, 255, ${o})`,
    labelColor:               ()      => colors.textMuted,
    propsForDots:             { r: '3', strokeWidth: '1', stroke: colors.primary },
    propsForBackgroundLines:  { stroke: colors.border },
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>Post-Race Analysis</Text>

      <TouchableOpacity style={styles.refreshBtn} onPress={fetchSummary} activeOpacity={0.75}>
        <Text style={styles.refreshText}>↻  Refresh</Text>
      </TouchableOpacity>

      {/* Loading spinner */}
      {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />}

      {/* Error state */}
      {!loading && error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Could not load race data</Text>
          <Text style={styles.errorMsg}>{error}</Text>
          <Text style={styles.errorHint}>
            Make sure the backend is running and your WebSocket URL is set on the Connection tab.
          </Text>
        </View>
      )}

      {/* Main content */}
      {!loading && summary && (
        <>
          {/* ── KPI grid ─────────────────────────────────────────── */}
          <View style={styles.kpiGrid}>
            <KpiCard
              value={summary.top_speed.toFixed(1)}
              label="Top Speed (m/s)"
              valueColor={colors.primary}
            />
            <KpiCard
              value={summary.average_speed.toFixed(1)}
              label="Avg Speed (m/s)"
            />
            <KpiCard
              value={`${summary.sensor_error_rate.toFixed(1)}%`}
              label="Sensor Error Rate"
              valueColor={summary.sensor_error_rate > 5 ? colors.danger : colors.success}
            />
            <KpiCard
              value={summary.packet_count}
              label="Total Packets"
            />
          </View>

          {/* ── Lap times ────────────────────────────────────────── */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Lap Times</Text>
            {summary.lap_times.map((lap, i) => {
              const isBest = lap === Math.min(...summary.lap_times);
              return (
                <View key={i} style={styles.lapRow}>
                  <Text style={styles.lapLabel}>Lap {i + 1}</Text>
                  <Text style={[styles.lapValue, isBest && styles.bestLap]}>
                    {lap.toFixed(2)} s{isBest ? '  🏆 Best' : ''}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* ── Speed over time ──────────────────────────────────── */}
          {summary.speed_series?.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Speed Over Time</Text>
              <LineChart
                data={{
                  labels:    summary.speed_series.map((d, i) => i % 5 === 0 ? `${d.time}s` : ''),
                  datasets:  [{ data: summary.speed_series.map(d => d.speed) }],
                }}
                width={CHART_W}
                height={180}
                chartConfig={chartCfg}
                bezier
                style={styles.chart}
                withInnerLines={false}
                withShadow={false}
              />
            </View>
          )}

          {/* ── Battery over time ────────────────────────────────── */}
          {summary.battery_series?.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Battery Over Time</Text>
              <LineChart
                data={{
                  labels:   summary.battery_series.map((d, i) => i % 5 === 0 ? `${d.time}s` : ''),
                  datasets: [{
                    data:  summary.battery_series.map(d => d.battery),
                    color: (o = 1) => `rgba(63, 185, 80, ${o})`,
                  }],
                }}
                width={CHART_W}
                height={180}
                chartConfig={{
                  ...chartCfg,
                  color: (o = 1) => `rgba(63, 185, 80, ${o})`,
                }}
                bezier
                style={styles.chart}
                withInnerLines={false}
                withShadow={false}
              />
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md },
  title:  { fontSize: 24, fontWeight: 'bold', color: colors.text, marginBottom: spacing.md },

  refreshBtn: {
    backgroundColor: colors.primaryDark,
    borderRadius:    8,
    padding:         spacing.sm,
    alignItems:      'center',
    marginBottom:    spacing.md,
  },
  refreshText: { color: colors.white, fontWeight: '600' },

  errorCard: {
    backgroundColor: colors.danger + '1a',
    borderRadius:    10,
    padding:         spacing.md,
    borderWidth:     1,
    borderColor:     colors.danger,
    marginBottom:    spacing.md,
  },
  errorTitle: { color: colors.danger, fontWeight: '700', marginBottom: 4 },
  errorMsg:   { color: colors.text,   fontSize: 13,      marginBottom: spacing.xs },
  errorHint:  { color: colors.textMuted, fontSize: 12 },

  kpiGrid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:            spacing.sm,
    marginBottom:   spacing.md,
  },
  kpiCard: {
    flex:            1,
    minWidth:        '45%',
    backgroundColor: colors.surface,
    borderRadius:    10,
    padding:         spacing.md,
    alignItems:      'center',
    borderWidth:     1,
    borderColor:     colors.border,
  },
  kpiValue: { fontSize: 26, fontWeight: 'bold', color: colors.text },
  kpiLabel: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 4 },

  card:      { ...card },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },

  lapRow: {
    flexDirection:    'row',
    justifyContent:   'space-between',
    paddingVertical:  spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lapLabel: { fontSize: 14, color: colors.textMuted },
  lapValue: { fontSize: 14, fontWeight: '500', color: colors.text },
  bestLap:  { color: colors.success, fontWeight: 'bold' },

  chart: { borderRadius: 8, marginTop: spacing.xs },
});
