/**
 * ManualControlScreen.js
 *
 * 2D joystick — same axes as the ESP32 web UI:
 *   X (left/right) → steering  (-100 … +100)
 *   Y (up/down)    → throttle  (+100 = forward, -100 = reverse)
 *
 * On release the knob springs back to center and throttle+steering reset to 0.
 */

import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Switch, PanResponder, Animated,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { colors, spacing, card } from '../styles/theme';

const OUTER = 260;          // outer circle diameter (px)
const KNOB  = 64;           // knob diameter (px)
const R     = (OUTER - KNOB) / 2;  // max travel radius from centre

export default function ManualControlScreen() {
  const { connected, sendCommand, telemetry } = useApp();

  const [steering,     setSteering]     = useState(0);
  const [throttle,     setThrottle]     = useState(0);
  const [isAutonomous, setIsAutonomous] = useState(false);

  const isEmergencyActive = telemetry?.emergency_stop ?? false;

  const steeringRef = useRef(0);
  const throttleRef = useRef(0);
  const disabledRef = useRef(false);
  disabledRef.current = !connected || isAutonomous || isEmergencyActive;

  const knobX = useRef(new Animated.Value(0)).current;
  const knobY = useRef(new Animated.Value(0)).current;

  // ── Helpers ────────────────────────────────────────────────────────────────

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

  const snapToCenter = () => {
    Animated.spring(knobX, { toValue: 0, useNativeDriver: true, tension: 180, friction: 10 }).start();
    Animated.spring(knobY, { toValue: 0, useNativeDriver: true, tension: 180, friction: 10 }).start();
    setSteering(0);
    setThrottle(0);
    steeringRef.current = 0;
    throttleRef.current = 0;
    sendDrive(0, 0);
  };

  // ── PanResponder ───────────────────────────────────────────────────────────

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder:  () => !disabledRef.current,

      onPanResponderGrant: () => {
        knobX.stopAnimation();
        knobY.stopAnimation();
      },

      onPanResponderMove: (_, g) => {
        // Clamp to circle
        const dist  = Math.sqrt(g.dx * g.dx + g.dy * g.dy);
        const scale = dist > R ? R / dist : 1;
        const cx    = g.dx * scale;
        const cy    = g.dy * scale;

        knobX.setValue(cx);
        knobY.setValue(cy);

        // Y is inverted: drag up → dy negative → positive throttle
        const s = Math.round((cx / R) * 100);
        const t = Math.round((-cy / R) * 100);

        setSteering(s);
        setThrottle(t);
        steeringRef.current = s;
        throttleRef.current = t;
        sendDrive(s, t);
      },

      onPanResponderRelease:   () => snapToCenter(),
      onPanResponderTerminate: () => snapToCenter(),
    })
  ).current;

  // ── Emergency stop helpers ─────────────────────────────────────────────────

  const onEmergencyStop = () =>
    sendCommand({ type: 'emergency_stop',       timestamp: Math.floor(Date.now() / 1000) });

  const onResetEmergency = () =>
    sendCommand({ type: 'reset_emergency_stop', timestamp: Math.floor(Date.now() / 1000) });

  // ── Derived colours ────────────────────────────────────────────────────────

  const joystickDisabled = !connected || isAutonomous || isEmergencyActive;
  const thrColor = throttle > 0 ? colors.success : throttle < 0 ? colors.danger : colors.textMuted;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>Manual Control</Text>

      {/* ── Banners ─────────────────────────────────────────────── */}
      {!connected && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Not connected — go to the Connection tab first.
          </Text>
        </View>
      )}
      {isEmergencyActive && (
        <View style={[styles.banner, styles.bannerDanger]}>
          <Text style={[styles.bannerText, { color: colors.danger }]}>
            🛑 EMERGENCY STOP is active — controls blocked.
          </Text>
        </View>
      )}

      {/* ── Mode switch ─────────────────────────────────────────── */}
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
          <Text style={styles.modeNote}>Autonomous mode — controls disabled.</Text>
        )}
      </View>

      {/* ── 2D Joystick ─────────────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Drive Joystick</Text>

        {/* Forward label */}
        <Text style={[styles.dirLabel, styles.dirTop, throttle > 10 && styles.dirActive]}>
          ▲  Forward
        </Text>

        {/* Middle row: Left — circle — Right */}
        <View style={styles.joyRow}>
          <Text style={[styles.dirLabel, steering < -10 && styles.dirActive]}>◀</Text>

          <View
            style={[styles.outerCircle, joystickDisabled && styles.outerDisabled]}
            {...(!joystickDisabled ? panResponder.panHandlers : {})}
          >
            {/* Crosshair */}
            <View style={styles.crossH} />
            <View style={styles.crossV} />

            {/* Knob */}
            <Animated.View
              style={[
                styles.knob,
                { transform: [{ translateX: knobX }, { translateY: knobY }] },
                (steering !== 0 || throttle !== 0) && styles.knobActive,
              ]}
            />
          </View>

          <Text style={[styles.dirLabel, steering > 10 && styles.dirActive]}>▶</Text>
        </View>

        {/* Reverse label */}
        <Text style={[styles.dirLabel, styles.dirBottom, throttle < -10 && styles.dirDanger]}>
          ▼  Reverse
        </Text>

        {/* Values */}
        <View style={styles.valRow}>
          <View style={styles.valBox}>
            <Text style={styles.valLabel}>Steering</Text>
            <Text style={[styles.valNum, { color: colors.primary }]}>
              {steering > 0 ? '+' : ''}{steering}
            </Text>
          </View>
          <View style={styles.valBox}>
            <Text style={styles.valLabel}>Throttle</Text>
            <Text style={[styles.valNum, { color: thrColor }]}>
              {throttle > 0 ? '+' : ''}{throttle}
            </Text>
          </View>
        </View>

        <Text style={styles.hint}>
          Drag to steer &amp; accelerate · Release → stops
        </Text>
      </View>

      {/* ── Live feedback ───────────────────────────────────────── */}
      {telemetry && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Car Feedback</Text>
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

      {/* ── Emergency stop ──────────────────────────────────────── */}
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

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md },
  title:  { fontSize: 24, fontWeight: 'bold', color: colors.text, marginBottom: spacing.md },

  banner: {
    borderRadius: 8, padding: spacing.sm, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warning + '22',
  },
  bannerDanger: { borderColor: colors.danger, backgroundColor: colors.danger + '22' },
  bannerText:   { color: colors.warning, fontSize: 13, textAlign: 'center' },

  card:      { ...card },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },

  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  modeLabel: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  modeActive:{ color: colors.primary },
  modeNote:  { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },

  // ── Joystick ──────────────────────────────────────────────────────────────
  joyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },

  outerCircle: {
    width:           OUTER,
    height:          OUTER,
    borderRadius:    OUTER / 2,
    backgroundColor: colors.surfaceAlt,
    borderWidth:     2,
    borderColor:     colors.border,
    alignItems:      'center',
    justifyContent:  'center',
    overflow:        'hidden',
  },
  outerDisabled: { opacity: 0.35 },

  crossH: {
    position:        'absolute',
    width:           '100%',
    height:          1,
    backgroundColor: colors.border,
  },
  crossV: {
    position:        'absolute',
    width:           1,
    height:          '100%',
    backgroundColor: colors.border,
  },

  knob: {
    position:        'absolute',
    width:           KNOB,
    height:          KNOB,
    borderRadius:    KNOB / 2,
    backgroundColor: colors.surfaceAlt,
    borderWidth:     2,
    borderColor:     colors.border,
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.5,
    shadowRadius:    4,
    elevation:       6,
  },
  knobActive: {
    borderColor:     colors.primary,
    backgroundColor: colors.primaryDark,
  },

  dirLabel: {
    fontSize: 13, fontWeight: '600', color: colors.textMuted, textAlign: 'center',
  },
  dirTop:    { marginBottom: spacing.xs },
  dirBottom: { marginTop: spacing.xs },
  dirActive: { color: colors.primary },
  dirDanger: { color: colors.danger },

  valRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.md,
  },
  valBox: { alignItems: 'center' },
  valLabel: { fontSize: 11, color: colors.textMuted, marginBottom: 2 },
  valNum:   { fontSize: 28, fontWeight: 'bold', fontVariant: ['tabular-nums'] },

  hint: {
    fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm,
  },

  // ── Feedback ──────────────────────────────────────────────────────────────
  feedbackRow:   { flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.xs },
  feedbackItem:  { alignItems: 'center' },
  feedbackLabel: { fontSize: 12, color: colors.textMuted },
  feedbackValue: { fontSize: 18, fontWeight: 'bold', color: colors.text },

  // ── Emergency stop ────────────────────────────────────────────────────────
  eStopBtn: {
    backgroundColor: colors.danger,
    borderRadius: 12, padding: spacing.lg,
    alignItems: 'center', marginBottom: spacing.sm,
  },
  eStopActive: {
    backgroundColor: '#7d1f1f', borderWidth: 2, borderColor: colors.danger,
  },
  eStopText: { color: colors.white, fontSize: 18, fontWeight: 'bold' },

  resetBtn: {
    borderRadius: 10, padding: spacing.md, alignItems: 'center',
    marginBottom: spacing.lg, borderWidth: 1,
    borderColor: colors.success, backgroundColor: colors.surfaceAlt,
  },
  resetDisabled: { borderColor: colors.border, opacity: 0.4 },
  resetText:     { color: colors.success, fontSize: 14, fontWeight: '600' },
});
