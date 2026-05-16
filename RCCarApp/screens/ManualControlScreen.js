/**
 * ManualControlScreen.js
 *
 * Steering: horizontal drag-and-snap joystick (PanResponder + Animated).
 *   - Drag left/right to steer (-100 … +100).
 *   - Release → knob springs back to center, steering resets to 0.
 *   - Releasing steering does NOT change throttle.
 *
 * Throttle: unchanged slider (0 … 100), does NOT reset on release.
 * Emergency stop: unchanged.
 */

import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  PanResponder,
  Animated,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { useApp } from '../context/AppContext';
import { colors, spacing, card } from '../styles/theme';

// Joystick dimensions
const KNOB_SIZE   = 56;   // diameter of the draggable knob
const TRACK_H     = 76;   // height of the joystick track bar

export default function ManualControlScreen() {
  const { connected, sendCommand, telemetry } = useApp();

  const [steering,     setSteering]     = useState(0);
  const [throttle,     setThrottle]     = useState(0);
  const [isAutonomous, setIsAutonomous] = useState(false);

  const isEmergencyActive = telemetry?.emergency_stop ?? false;

  // ── Refs ─────────────────────────────────────────────────────────────────
  // Using refs (not state) inside PanResponder callbacks avoids stale closures.

  const throttleRef      = useRef(0);
  const steeringRef      = useRef(0);
  const trackWidthRef    = useRef(0);   // actual rendered track width (set on layout)
  const maxOffsetRef     = useRef(0);   // max pixels the knob can travel from center
   // knob offset at gesture start

  // Updated every render so panResponder always sees the current disabled state.
  const disabledRef = useRef(false);
  disabledRef.current = !connected || isAutonomous || isEmergencyActive;

  // Animated X position of the knob (0 = center).
  const knobX = useRef(new Animated.Value(0)).current;

  // ── Helpers ───────────────────────────────────────────────────────────────

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const offsetToSteering = (offset) => {
    const max = maxOffsetRef.current;
    return max === 0 ? 0 : Math.round((offset / max) * 100);
  };

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

  // ── Throttle slider ───────────────────────────────────────────────────────

  const onThrottleChange = (v) => {
    setThrottle(v);
    throttleRef.current = v;
    sendDrive(steeringRef.current, v);
  };

  // ── Steering joystick ─────────────────────────────────────────────────────

  // Called when the track View is first laid out so we know its pixel width.
  const onTrackLayout = (e) => {
    const w = e.nativeEvent.layout.width;
    trackWidthRef.current = w;
    maxOffsetRef.current  = (w - KNOB_SIZE) / 2 - 4; // 4px padding from each edge
  };

  const snapToCenter = () => {
    Animated.spring(knobX, {
      toValue:         0,
      useNativeDriver: true,
      tension:         180,
      friction:        10,
    }).start();
    setSteering(0);
    steeringRef.current = 0;
    // Keep throttle as-is — only reset steering.
    sendDrive(0, throttleRef.current);
  };

  // PanResponder lives in a ref so it is created once and never recreated.
  // All mutable values it reads come from refs, so no stale-closure issues.
  const panResponder = useRef(
    PanResponder.create({

      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder:  () => !disabledRef.current,

      onPanResponderGrant: () => {
        // Stop any in-flight spring. Knob stays at center — no jump to touch position.
        knobX.stopAnimation();
      },

      onPanResponderMove: (_, gesture) => {
        // Use ONLY gesture.dx — how far the finger has moved since touch-down.
        // This means a tap produces 0 movement and steering stays at 0.
        const max     = maxOffsetRef.current;
        const clamped = Math.max(-max, Math.min(max, gesture.dx));

        knobX.setValue(clamped);

        const value = Math.round((clamped / max) * 100);
        setSteering(value);
        steeringRef.current = value;
        sendDrive(value, throttleRef.current);
      },

      onPanResponderRelease:   () => snapToCenter(),
      // Also snap if another gesture steals the responder (e.g. scroll view).
      onPanResponderTerminate: () => snapToCenter(),
    })
  ).current;

  // ── Emergency stop helpers ────────────────────────────────────────────────

  const onEmergencyStop = () =>
    sendCommand({ type: 'emergency_stop',       timestamp: Math.floor(Date.now() / 1000) });

  const onResetEmergency = () =>
    sendCommand({ type: 'reset_emergency_stop', timestamp: Math.floor(Date.now() / 1000) });

  // ── Render ────────────────────────────────────────────────────────────────

  const joystickDisabled = !connected || isAutonomous || isEmergencyActive;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>Manual Control</Text>

      {/* ── Banners ───────────────────────────────────────────────── */}
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

      {/* ── Mode switch ───────────────────────────────────────────── */}
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

      {/* ── Steering joystick ─────────────────────────────────────── */}
      <View style={styles.card}>
        {/* Header row */}
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>Steering</Text>
          <Text style={[
            styles.bigValue,
            { color: steering === 0 ? colors.textMuted : colors.primary },
          ]}>
            {steering > 0 ? '+' : ''}{steering}
          </Text>
        </View>

        {/* Joystick track */}
        <View
          style={[styles.track, joystickDisabled && styles.trackDisabled]}
          onLayout={onTrackLayout}
          {...(!joystickDisabled ? panResponder.panHandlers : {})}
        >
          {/* Left-zone tint */}
          <View style={[styles.zoneTint, styles.zoneTintLeft,
            { opacity: steering < 0 ? Math.abs(steering) / 100 * 0.5 : 0 }]}
          />
          {/* Right-zone tint */}
          <View style={[styles.zoneTint, styles.zoneTintRight,
            { opacity: steering > 0 ? steering / 100 * 0.5 : 0 }]}
          />

          {/* Center tick */}
          <View style={styles.centerTick} />

          {/* Draggable knob */}
          <Animated.View
            style={[
              styles.knob,
              { transform: [{ translateX: knobX }] },
              joystickDisabled && styles.knobDisabled,
              steering !== 0 && styles.knobActive,
            ]}
          >
            {/* Inner dot */}
            <View style={styles.knobDot} />
          </Animated.View>
        </View>

        {/* Direction labels */}
        <View style={styles.rowBetween}>
          <Text style={[styles.dirLabel, steering < -10 && { color: colors.primary }]}>
            ◀ Left
          </Text>
          <Text style={styles.dirLabelCenter}>Center</Text>
          <Text style={[styles.dirLabel, steering > 10 && { color: colors.primary }]}>
            Right ▶
          </Text>
        </View>

        <Text style={styles.joystickHint}>
          Drag left or right · releases automatically to center
        </Text>
      </View>

      {/* ── Throttle slider ───────────────────────────────────────── */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>Throttle</Text>
          <Text style={[styles.bigValue, { color: colors.success }]}>
            {Math.round(throttle)}
          </Text>
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
          disabled={!connected || isAutonomous || isEmergencyActive}
        />
        <View style={styles.rowBetween}>
          <Text style={styles.tick}>0</Text>
          <Text style={styles.tick}>50</Text>
          <Text style={styles.tick}>100</Text>
        </View>
      </View>

      {/* ── Live feedback ─────────────────────────────────────────── */}
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

      {/* ── Emergency stop ────────────────────────────────────────── */}
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

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md },
  title:  { fontSize: 24, fontWeight: 'bold', color: colors.text, marginBottom: spacing.md },

  // Banners
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

  // Cards / shared
  card:         { ...card },
  cardTitle:    { fontSize: 15, fontWeight: '600', color: colors.text },
  rowBetween:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  bigValue:     { fontSize: 28, fontWeight: 'bold', color: colors.primary },

  // Mode switch
  switchRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, marginTop: spacing.sm },
  modeLabel:  { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  modeActive: { color: colors.primary },
  modeNote:   { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },

  // ── Joystick track ───────────────────────────────────────────────────────
  track: {
    width:           '100%',
    height:          TRACK_H,
    borderRadius:    TRACK_H / 2,
    backgroundColor: colors.surfaceAlt,
    borderWidth:     1,
    borderColor:     colors.border,
    alignItems:      'center',
    justifyContent:  'center',
    overflow:        'hidden',   // clip the tint views
    marginVertical:  spacing.sm,
    position:        'relative',
  },
  trackDisabled: {
    opacity: 0.4,
  },

  // Tinted left/right zones that brighten as the knob moves outward
  zoneTint: {
    position:        'absolute',
    top:             0,
    bottom:          0,
    width:           '50%',
    backgroundColor: colors.primary,
  },
  zoneTintLeft:  { left: 0 },
  zoneTintRight: { right: 0 },

  // Subtle center tick mark
  centerTick: {
    position:        'absolute',
    width:           2,
    height:          '40%',
    borderRadius:    1,
    backgroundColor: colors.border,
    // centered horizontally via self-positioning inside alignItems:'center'
  },

  // Draggable knob
  knob: {
    position:        'absolute',
    width:           KNOB_SIZE,
    height:          KNOB_SIZE,
    borderRadius:    KNOB_SIZE / 2,
    backgroundColor: colors.surfaceAlt,
    borderWidth:     2,
    borderColor:     colors.border,
    alignItems:      'center',
    justifyContent:  'center',
    // shadow
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.4,
    shadowRadius:    4,
    elevation:       6,
  },
  knobActive: {
    borderColor:     colors.primary,
    backgroundColor: colors.primaryDark,
  },
  knobDisabled: {
    borderColor: colors.border,
  },
  knobDot: {
    width:           12,
    height:          12,
    borderRadius:    6,
    backgroundColor: colors.textMuted,
  },

  // Labels under joystick
  dirLabel: {
    fontSize:   12,
    color:      colors.textMuted,
    fontWeight: '500',
  },
  dirLabelCenter: {
    fontSize: 11,
    color:    colors.border,
  },
  joystickHint: {
    fontSize:   11,
    color:      colors.textMuted,
    textAlign:  'center',
    marginTop:  spacing.xs,
  },

  // Throttle slider
  hint:   { fontSize: 11, color: colors.textMuted, marginBottom: spacing.xs },
  slider: { width: '100%', height: 40 },
  tick:   { fontSize: 11, color: colors.textMuted },

  // Telemetry feedback
  feedbackRow:   { flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.xs },
  feedbackItem:  { alignItems: 'center' },
  feedbackLabel: { fontSize: 12, color: colors.textMuted },
  feedbackValue: { fontSize: 18, fontWeight: 'bold', color: colors.text },

  // Emergency stop
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
