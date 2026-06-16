/**
 * ManualControlScreen.js — 2D joystick controller
 *
 * Normal mode : joystick X = steering, Y = throttle. Release → all 0.
 * Lock mode   : joystick X = steering only. Bottom slider sets fixed throttle.
 */

import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Switch, PanResponder, Animated, Dimensions,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { useApp } from '../context/AppContext';
import { colors, spacing } from '../styles/theme';

const { width: SCREEN_W } = Dimensions.get('window');
const OUTER = Math.min(SCREEN_W - 80, 300);
const KNOB  = 70;
const R     = (OUTER - KNOB) / 2;

export default function ManualControlScreen() {
  const { connected, sendCommand, telemetry } = useApp();

  const [steering,       setSteering]       = useState(0);
  const [throttle,       setThrottle]       = useState(0);
  const [isAutonomous,   setIsAutonomous]   = useState(false);
  const [throttleLocked, setThrottleLocked] = useState(false);
  const [lockedThrottle, setLockedThrottle] = useState(0);

  const isEmergencyActive = telemetry?.emergency_stop ?? false;

  const steeringRef       = useRef(0);
  const throttleRef       = useRef(0);
  const throttleLockedRef = useRef(false);
  const lockedThrottleRef = useRef(0);
  const disabledRef       = useRef(false);

  disabledRef.current       = !connected || isAutonomous || isEmergencyActive;
  throttleLockedRef.current = throttleLocked;
  lockedThrottleRef.current = lockedThrottle;

  const knobX = useRef(new Animated.Value(0)).current;
  const knobY = useRef(new Animated.Value(0)).current;

  // ── Send ──────────────────────────────────────────────────────────────────

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

  // ── Snap back ─────────────────────────────────────────────────────────────

  const snapToCenter = () => {
    Animated.spring(knobX, { toValue: 0, useNativeDriver: true, tension: 200, friction: 12 }).start();
    Animated.spring(knobY, { toValue: 0, useNativeDriver: true, tension: 200, friction: 12 }).start();
    setSteering(0);
    steeringRef.current = 0;

    if (throttleLockedRef.current) {
      const t = lockedThrottleRef.current;
      setThrottle(t);
      throttleRef.current = t;
      sendDrive(0, t);
    } else {
      setThrottle(0);
      throttleRef.current = 0;
      sendDrive(0, 0);
    }
  };

  // ── Throttle lock toggle ──────────────────────────────────────────────────

  const toggleLock = () => {
    if (throttleLocked) {
      setThrottleLocked(false);
      setLockedThrottle(0);
      setThrottle(0);
      throttleRef.current = 0;
      sendDrive(steeringRef.current, 0);
    } else {
      setThrottleLocked(true);
      setLockedThrottle(0);
    }
  };

  const onLockedThrottleChange = (v) => {
    const t = Math.round(v);
    setLockedThrottle(t);
    lockedThrottleRef.current = t;
    setThrottle(t);
    throttleRef.current = t;
    sendDrive(steeringRef.current, t);
  };

  // ── PanResponder ──────────────────────────────────────────────────────────

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => !disabledRef.current,
      onMoveShouldSetPanResponderCapture:  () => !disabledRef.current,

      onPanResponderGrant: () => {
        knobX.stopAnimation();
        knobY.stopAnimation();
      },

      onPanResponderMove: (_, g) => {
        const dist  = Math.sqrt(g.dx * g.dx + g.dy * g.dy);
        const scale = dist > R ? R / dist : 1;
        const cx    = g.dx * scale;
        const cy    = throttleLockedRef.current ? 0 : g.dy * scale;

        knobX.setValue(cx);
        knobY.setValue(cy);

        const s = Math.round((cx / R) * 100);
        const t = throttleLockedRef.current
          ? lockedThrottleRef.current
          : Math.round((-cy / R) * 100);

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

  // ── Emergency ─────────────────────────────────────────────────────────────

  const onEmergencyStop = () =>
    sendCommand({ type: 'emergency_stop',       timestamp: Math.floor(Date.now() / 1000) });
  const onResetEmergency = () =>
    sendCommand({ type: 'reset_emergency_stop', timestamp: Math.floor(Date.now() / 1000) });

  // ── Derived ───────────────────────────────────────────────────────────────

  const joystickDisabled = !connected || isAutonomous || isEmergencyActive;
  const thrColor = throttle > 0 ? colors.success : throttle < 0 ? colors.danger : colors.textMuted;
  const strColor = steering !== 0 ? colors.primary : colors.textMuted;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>

      {/* ── Top bar ───────────────────────────────────────────────── */}
      <View style={styles.topBar}>
        {!connected && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>Not connected — go to Connection tab first.</Text>
          </View>
        )}
        {isEmergencyActive && (
          <View style={[styles.banner, styles.bannerDanger]}>
            <Text style={[styles.bannerText, { color: colors.danger }]}>
              🛑  EMERGENCY STOP — controls blocked
            </Text>
          </View>
        )}
        <View style={styles.modeRow}>
          <Text style={[styles.modeLabel, !isAutonomous && styles.modeActive]}>Manual</Text>
          <Switch
            value={isAutonomous}
            onValueChange={setIsAutonomous}
            trackColor={{ false: colors.primaryDark, true: colors.success }}
            thumbColor={colors.white}
          />
          <Text style={[styles.modeLabel, isAutonomous && styles.modeActive]}>Autonomous</Text>
        </View>
      </View>

      {/* ── Joystick ──────────────────────────────────────────────── */}
      <View style={styles.joyArea}>
        {!throttleLocked && (
          <Text style={[styles.dir, styles.dirTop, throttle > 10 && styles.dirFwd]}>▲ Forward</Text>
        )}
        {!throttleLocked && (
          <Text style={[styles.dir, styles.dirBottom, throttle < -10 && styles.dirRev]}>▼ Reverse</Text>
        )}
        <Text style={[styles.dir, styles.dirLeft,  steering < -10 && styles.dirSide]}>◀</Text>
        <Text style={[styles.dir, styles.dirRight, steering > 10  && styles.dirSide]}>▶</Text>

        <View
          style={[styles.outerCircle, joystickDisabled && styles.outerDisabled,
                  throttleLocked && styles.outerLocked]}
          {...(!joystickDisabled ? panResponder.panHandlers : {})}
        >
          <View style={styles.crossH} />
          {!throttleLocked && <View style={styles.crossV} />}
          <Animated.View
            style={[
              styles.knob,
              { transform: [{ translateX: knobX }, { translateY: knobY }] },
              (steering !== 0 || throttle !== 0) && styles.knobActive,
              joystickDisabled && styles.knobDisabled,
            ]}
          />
        </View>

        {/* Values */}
        <View style={styles.valRow}>
          <View style={styles.valBox}>
            <Text style={styles.valLabel}>Steering</Text>
            <Text style={[styles.valNum, { color: strColor }]}>
              {steering > 0 ? '+' : ''}{steering}
            </Text>
          </View>
          <View style={styles.valSep} />
          <View style={styles.valBox}>
            <Text style={styles.valLabel}>Throttle</Text>
            <Text style={[styles.valNum, { color: thrColor }]}>
              {throttle > 0 ? '+' : ''}{throttle}
            </Text>
          </View>
          {telemetry && (
            <>
              <View style={styles.valSep} />
              <View style={styles.valBox}>
                <Text style={styles.valLabel}>Speed</Text>
                <Text style={[styles.valNum, { color: colors.primary }]}>
                  {telemetry.speed}<Text style={styles.valUnit}> m/s</Text>
                </Text>
              </View>
            </>
          )}
        </View>

        <Text style={styles.hint}>
          {throttleLocked
            ? 'Steer left/right · Throttle locked by slider'
            : 'Hold & drag · Release to stop'}
        </Text>
      </View>

      {/* ── Throttle lock panel ───────────────────────────────────── */}
      <View style={styles.lockPanel}>
        <TouchableOpacity
          style={[styles.lockBtn, throttleLocked && styles.lockBtnActive]}
          onPress={toggleLock}
          disabled={joystickDisabled}
          activeOpacity={0.75}
        >
          <Text style={[styles.lockBtnText, throttleLocked && styles.lockBtnTextActive]}>
            {throttleLocked ? '🔒  Throttle Lock ON' : '🔓  Throttle Lock OFF'}
          </Text>
        </TouchableOpacity>

        {throttleLocked && (
          <View style={styles.sliderBox}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>Fixed Throttle</Text>
              <Text style={[styles.sliderVal, { color: thrColor }]}>
                {lockedThrottle > 0 ? '+' : ''}{lockedThrottle}
              </Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={-100}
              maximumValue={100}
              step={1}
              value={lockedThrottle}
              onValueChange={onLockedThrottleChange}
              minimumTrackTintColor={lockedThrottle >= 0 ? colors.success : colors.danger}
              maximumTrackTintColor={colors.border}
              thumbTintColor={colors.success}
              disabled={joystickDisabled}
            />
            <View style={styles.sliderTicks}>
              <Text style={styles.tick}>-100</Text>
              <Text style={styles.tick}>0</Text>
              <Text style={styles.tick}>+100</Text>
            </View>
          </View>
        )}
      </View>

      {/* ── Emergency stop ────────────────────────────────────────── */}
      <View style={styles.bottomBar}>
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
        {isEmergencyActive && (
          <TouchableOpacity style={styles.resetBtn} onPress={onResetEmergency} disabled={!connected}>
            <Text style={styles.resetText}>Reset Emergency Stop</Text>
          </TouchableOpacity>
        )}
      </View>

    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, flexDirection: 'column' },

  topBar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  banner: {
    borderRadius: 8, padding: spacing.xs, marginBottom: spacing.xs,
    borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warning + '22',
  },
  bannerDanger: { borderColor: colors.danger, backgroundColor: colors.danger + '22' },
  bannerText:   { color: colors.warning, fontSize: 12, textAlign: 'center' },
  modeRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  modeLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  modeActive:{ color: colors.primary },

  joyArea: { flex: 1, alignItems: 'center', justifyContent: 'center', position: 'relative' },

  dir:       { position: 'absolute', fontSize: 13, fontWeight: '600', color: colors.border },
  dirTop:    { top: -28, alignSelf: 'center' },
  dirBottom: { bottom: -28, alignSelf: 'center' },
  dirLeft:   { left: -28 },
  dirRight:  { right: -28 },
  dirFwd:    { color: colors.success },
  dirRev:    { color: colors.danger },
  dirSide:   { color: colors.primary },

  outerCircle: {
    width: OUTER, height: OUTER, borderRadius: OUTER / 2,
    backgroundColor: '#111', borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  outerDisabled: { opacity: 0.35 },
  outerLocked:   { borderColor: colors.warning + '88' },

  crossH: { position: 'absolute', width: '100%', height: 1, backgroundColor: '#222' },
  crossV: { position: 'absolute', width: 1, height: '100%', backgroundColor: '#222' },

  knob: {
    position: 'absolute', width: KNOB, height: KNOB, borderRadius: KNOB / 2,
    backgroundColor: '#1e1e1e', borderWidth: 2, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.6, shadowRadius: 5, elevation: 8,
  },
  knobActive:   { borderColor: colors.primary, backgroundColor: colors.primaryDark },
  knobDisabled: { borderColor: '#333' },

  valRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.md, gap: spacing.lg },
  valBox:  { alignItems: 'center', minWidth: 64 },
  valSep:  { width: 1, height: 32, backgroundColor: colors.border },
  valLabel:{ fontSize: 10, color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase' },
  valNum:  { fontSize: 26, fontWeight: 'bold', fontVariant: ['tabular-nums'] },
  valUnit: { fontSize: 12, fontWeight: 'normal', color: colors.textMuted },
  hint:    { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },

  // Lock panel
  lockPanel: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  lockBtn: {
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
    borderRadius: 20, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceAlt, alignSelf: 'center', marginBottom: spacing.xs,
  },
  lockBtnActive:    { borderColor: colors.warning, backgroundColor: colors.warning + '22' },
  lockBtnText:      { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  lockBtnTextActive:{ color: colors.warning },

  sliderBox: {
    backgroundColor: colors.surfaceAlt, borderRadius: 12,
    borderWidth: 1, borderColor: colors.warning + '55',
    padding: spacing.sm, marginTop: spacing.xs,
  },
  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  sliderLabel:  { fontSize: 11, color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase' },
  sliderVal:    { fontSize: 14, fontWeight: 'bold', fontVariant: ['tabular-nums'] },
  slider:       { width: '100%', height: 36 },
  sliderTicks:  { flexDirection: 'row', justifyContent: 'space-between' },
  tick:         { fontSize: 10, color: colors.textMuted },

  // Bottom
  bottomBar: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.xs },
  eStopBtn:  { backgroundColor: colors.danger, borderRadius: 12, padding: spacing.md, alignItems: 'center' },
  eStopActive:{ backgroundColor: '#7d1f1f', borderWidth: 2, borderColor: colors.danger },
  eStopText: { color: colors.white, fontSize: 16, fontWeight: 'bold' },
  resetBtn:  { borderRadius: 10, padding: spacing.sm, alignItems: 'center', borderWidth: 1, borderColor: colors.success, backgroundColor: colors.surfaceAlt },
  resetText: { color: colors.success, fontSize: 13, fontWeight: '600' },
});
