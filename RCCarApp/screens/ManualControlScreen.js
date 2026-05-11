/**
 * ManualControlScreen.js
 *
 * Steering slider (-100 … +100), throttle slider (0 … 100),
 * Manual / Autonomous mode switch, Emergency Stop, and Reset.
 *
 * Sliders send a command to the backend on every change while dragging.
 * Refs are used to avoid stale-closure issues between the two sliders.
 */

import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { useApp } from '../context/AppContext';
import { colors, spacing, card } from '../styles/theme';

export default function ManualControlScreen() {
  const { connected, sendCommand, telemetry } = useApp();

  const [steering,     setSteering]     = useState(0);
  const [throttle,     setThrottle]     = useState(0);
  const [isAutonomous, setIsAutonomous] = useState(false);

  // Refs prevent stale-closure problems when one slider sends the other's value.
  const steeringRef = useRef(0);
  const throttleRef = useRef(0);

  const isEmergencyActive = telemetry?.emergency_stop ?? false;
  const slidersDisabled   = !connected || isAutonomous || isEmergencyActive;

  // ── Helpers ─────────────────────────────────────────────────────────────

  const sendDrive = (s, t) => {
    if (!connected || isAutonomous) return;
    sendCommand({
      type:      'command',
      steering:  Math.round(s),
      throttle:  Math.round(t),
      mode:      'manual',
      timestamp: Math.floor(Date.now() / 1000),
    });
  };

  const onSteeringChange = (v) => {
    setSteering(v);
    steeringRef.current = v;
    sendDrive(v, throttleRef.current);
  };

  const onThrottleChange = (v) => {
    setThrottle(v);
    throttleRef.current = v;
    sendDrive(steeringRef.current, v);
  };

  const onEmergencyStop = () =>
    sendCommand({ type: 'emergency_stop', timestamp: Math.floor(Date.now() / 1000) });

  const onResetEmergency = () =>
    sendCommand({ type: 'reset_emergency_stop', timestamp: Math.floor(Date.now() / 1000) });

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>Manual Control</Text>

      {/* Not-connected warning */}
      {!connected && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Not connected — go to the Connection tab first.
          </Text>
        </View>
      )}

      {/* Emergency stop alert */}
      {isEmergencyActive && (
        <View style={[styles.banner, styles.bannerDanger]}>
          <Text style={[styles.bannerText, { color: colors.danger }]}>
            🛑 EMERGENCY STOP is active — throttle blocked.
          </Text>
        </View>
      )}

      {/* ── Mode switch ─────────────────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Drive Mode</Text>
        <View style={styles.switchRow}>
          <Text style={[styles.modeLabel, !isAutonomous && styles.modeActive]}>Manual</Text>
          <Switch
            value={isAutonomous}
            onValueChange={setIsAutonomous}
            trackColor={{ false: colors.primaryDark, true: colors.success }}
            thumbColor={colors.white}
          />
          <Text style={[styles.modeLabel, isAutonomous && styles.modeActive]}>Autonomous</Text>
        </View>
        {isAutonomous && (
          <Text style={styles.modeNote}>
            Autonomous mode — sliders disabled, car is self-driving.
          </Text>
        )}
      </View>

      {/* ── Steering ────────────────────────────────────────────────── */}
      <View style={styles.card}>
        <View style={styles.sliderHeader}>
          <Text style={styles.cardTitle}>Steering</Text>
          <Text style={styles.bigValue}>{Math.round(steering) > 0 ? '+' : ''}{Math.round(steering)}</Text>
        </View>
        <Text style={styles.hint}>◀ Left  ·  Center  ·  Right ▶</Text>
        <Slider
          style={styles.slider}
          minimumValue={-100}
          maximumValue={100}
          value={steering}
          onValueChange={onSteeringChange}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.primary}
          disabled={slidersDisabled}
        />
        <View style={styles.tickRow}>
          <Text style={styles.tick}>-100</Text>
          <Text style={styles.tick}>0</Text>
          <Text style={styles.tick}>+100</Text>
        </View>
      </View>

      {/* ── Throttle ─────────────────────────────────────────────────── */}
      <View style={styles.card}>
        <View style={styles.sliderHeader}>
          <Text style={styles.cardTitle}>Throttle</Text>
          <Text style={[styles.bigValue, { color: colors.success }]}>{Math.round(throttle)}</Text>
        </View>
        <Text style={styles.hint}>Stop → Full Speed</Text>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={100}
          value={throttle}
          onValueChange={onThrottleChange}
          minimumTrackTintColor={colors.success}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.success}
          disabled={slidersDisabled}
        />
        <View style={styles.tickRow}>
          <Text style={styles.tick}>0</Text>
          <Text style={styles.tick}>50</Text>
          <Text style={styles.tick}>100</Text>
        </View>
      </View>

      {/* ── Live feedback from telemetry ────────────────────────────── */}
      {telemetry && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Car Feedback (from telemetry)</Text>
          <View style={styles.feedbackRow}>
            <View style={styles.feedbackItem}>
              <Text style={styles.feedbackLabel}>Steering</Text>
              <Text style={styles.feedbackValue}>{telemetry.current_steering}</Text>
            </View>
            <View style={styles.feedbackItem}>
              <Text style={styles.feedbackLabel}>Throttle</Text>
              <Text style={styles.feedbackValue}>{telemetry.current_throttle}</Text>
            </View>
            <View style={styles.feedbackItem}>
              <Text style={styles.feedbackLabel}>Speed</Text>
              <Text style={styles.feedbackValue}>{telemetry.speed} m/s</Text>
            </View>
          </View>
        </View>
      )}

      {/* ── Emergency stop buttons ───────────────────────────────────── */}
      <TouchableOpacity
        style={[styles.eStopBtn, isEmergencyActive && styles.eStopActive]}
        onPress={onEmergencyStop}
        disabled={!connected}
        activeOpacity={0.75}
      >
        <Text style={styles.eStopText}>
          {isEmergencyActive ? '🛑  EMERGENCY STOP ACTIVE' : '⚠   EMERGENCY STOP'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.resetBtn,
          (!connected || !isEmergencyActive) && styles.resetDisabled,
        ]}
        onPress={onResetEmergency}
        disabled={!connected || !isEmergencyActive}
        activeOpacity={0.75}
      >
        <Text style={styles.resetText}>Reset Emergency Stop</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:         { flex: 1, backgroundColor: colors.background },
  scroll:       { padding: spacing.md },
  title:        { fontSize: 24, fontWeight: 'bold', color: colors.text, marginBottom: spacing.md },

  banner: {
    borderRadius:    8,
    padding:         spacing.sm,
    marginBottom:    spacing.sm,
    borderWidth:     1,
    borderColor:     colors.warning,
    backgroundColor: colors.warning + '22',
  },
  bannerDanger: { borderColor: colors.danger, backgroundColor: colors.danger + '22' },
  bannerText:   { color: colors.warning, fontSize: 13, textAlign: 'center' },

  card:      { ...card },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text },

  switchRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, marginTop: spacing.sm },
  modeLabel:  { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  modeActive: { color: colors.primary },
  modeNote:   { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },

  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  bigValue:     { fontSize: 26, fontWeight: 'bold', color: colors.primary },
  hint:         { fontSize: 11, color: colors.textMuted, marginBottom: spacing.xs },
  slider:       { width: '100%', height: 40 },
  tickRow:      { flexDirection: 'row', justifyContent: 'space-between' },
  tick:         { fontSize: 11, color: colors.textMuted },

  feedbackRow:   { flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.xs },
  feedbackItem:  { alignItems: 'center' },
  feedbackLabel: { fontSize: 12, color: colors.textMuted },
  feedbackValue: { fontSize: 18, fontWeight: 'bold', color: colors.text },

  eStopBtn: {
    backgroundColor: colors.danger,
    borderRadius:    12,
    padding:         spacing.lg,
    alignItems:      'center',
    marginBottom:    spacing.sm,
  },
  eStopActive: {
    backgroundColor: '#7d1f1f',
    borderWidth:     2,
    borderColor:     colors.danger,
  },
  eStopText: { color: colors.white, fontSize: 18, fontWeight: 'bold' },

  resetBtn: {
    borderRadius:    10,
    padding:         spacing.md,
    alignItems:      'center',
    marginBottom:    spacing.lg,
    borderWidth:     1,
    borderColor:     colors.success,
    backgroundColor: colors.surfaceAlt,
  },
  resetDisabled: { borderColor: colors.border, opacity: 0.4 },
  resetText:     { color: colors.success, fontSize: 14, fontWeight: '600' },
});
