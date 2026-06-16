/**
 * ManualControlScreen.js — 2D joystick controller
 *
 * Fixed layout (no ScrollView) so the joystick gesture is never stolen.
 * Uses capture-phase PanResponder so touches register immediately.
 *
 * X axis → steering  (-100 … +100, left/right)
 * Y axis → throttle  (+100 = forward, -100 = reverse)
 * Release → snaps to centre, sends 0/0
 */

import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Switch, PanResponder, Animated, Dimensions,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { colors, spacing, card } from '../styles/theme';

const { width: SCREEN_W } = Dimensions.get('window');
const OUTER = Math.min(SCREEN_W - 80, 300);   // circle fits any phone
const KNOB  = 70;
const R     = (OUTER - KNOB) / 2;

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

  // ── Send helpers ────────────────────────────────────────────────────────────

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
    Animated.spring(knobX, { toValue: 0, useNativeDriver: true, tension: 200, friction: 12 }).start();
    Animated.spring(knobY, { toValue: 0, useNativeDriver: true, tension: 200, friction: 12 }).start();
    setSteering(0);
    setThrottle(0);
    steeringRef.current = 0;
    throttleRef.current = 0;
    sendDrive(0, 0);
  };

  // ── PanResponder ─────────────────────────────────────────────────────────────
  // Use CAPTURE phase so ScrollView parents never steal the gesture.

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
        const cy    = g.dy * scale;

        knobX.setValue(cx);
        knobY.setValue(cy);

        // Y inverted: drag up → dy negative → positive throttle (forward)
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

  // ── Emergency stop ──────────────────────────────────────────────────────────

  const onEmergencyStop = () =>
    sendCommand({ type: 'emergency_stop',       timestamp: Math.floor(Date.now() / 1000) });
  const onResetEmergency = () =>
    sendCommand({ type: 'reset_emergency_stop', timestamp: Math.floor(Date.now() / 1000) });

  // ── Colours ─────────────────────────────────────────────────────────────────

  const joystickDisabled = !connected || isAutonomous || isEmergencyActive;
  const thrColor = throttle > 0 ? colors.success : throttle < 0 ? colors.danger : colors.textMuted;
  const strColor = steering !== 0 ? colors.primary : colors.textMuted;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>

      {/* ── Top bar ─────────────────────────────────────────────── */}
      <View style={styles.topBar}>
        {/* Connection banner */}
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

        {/* Mode switch */}
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

      {/* ── Joystick area ───────────────────────────────────────── */}
      <View style={styles.joyArea}>

        {/* Direction labels */}
        <Text style={[styles.dir, styles.dirTop,    throttle > 10  && styles.dirFwd]}>▲ Forward</Text>
        <Text style={[styles.dir, styles.dirBottom, throttle < -10 && styles.dirRev]}>▼ Reverse</Text>
        <Text style={[styles.dir, styles.dirLeft,   steering < -10 && styles.dirSide]}>◀</Text>
        <Text style={[styles.dir, styles.dirRight,  steering > 10  && styles.dirSide]}>▶</Text>

        {/* Circle */}
        <View
          style={[styles.outerCircle, joystickDisabled && styles.outerDisabled]}
          {...(!joystickDisabled ? panResponder.panHandlers : {})}
        >
          <View style={styles.crossH} />
          <View style={styles.crossV} />

          <Animated.View
            style={[
              styles.knob,
              { transform: [{ translateX: knobX }, { translateY: knobY }] },
              (steering !== 0 || throttle !== 0) && styles.knobActive,
              joystickDisabled && styles.knobDisabled,
            ]}
          />
        </View>

        {/* Live values */}
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
                  {telemetry.speed}
                  <Text style={styles.valUnit}> m/s</Text>
                </Text>
              </View>
            </>
          )}
        </View>

        <Text style={styles.hint}>Hold &amp; drag · Release to stop</Text>
      </View>

      {/* ── Bottom: emergency stop ───────────────────────────────── */}
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
          <TouchableOpacity
            style={styles.resetBtn}
            onPress={onResetEmergency}
            disabled={!connected}
            activeOpacity={0.75}
          >
            <Text style={styles.resetText}>Reset Emergency Stop</Text>
          </TouchableOpacity>
        )}
      </View>

    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex:            1,
    backgroundColor: colors.background,
    flexDirection:   'column',
  },

  // Top bar
  topBar: {
    paddingHorizontal: spacing.md,
    paddingTop:        spacing.sm,
    paddingBottom:     spacing.xs,
  },
  banner: {
    borderRadius: 8, padding: spacing.xs, marginBottom: spacing.xs,
    borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warning + '22',
  },
  bannerDanger: { borderColor: colors.danger, backgroundColor: colors.danger + '22' },
  bannerText:   { color: colors.warning, fontSize: 12, textAlign: 'center' },

  modeRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: spacing.md,
  },
  modeLabel:  { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  modeActive: { color: colors.primary },

  // Joystick area — fills remaining space
  joyArea: {
    flex:            1,
    alignItems:      'center',
    justifyContent:  'center',
    position:        'relative',
  },

  // Direction labels positioned relative to circle
  dir: {
    position:   'absolute',
    fontSize:   13,
    fontWeight: '600',
    color:      colors.border,
  },
  dirTop:    { top:  (Dimensions.get('window').height * 0.5 - OUTER / 2 - 26), alignSelf: 'center' },
  dirBottom: { bottom: (Dimensions.get('window').height * 0.5 - OUTER / 2 - 26), alignSelf: 'center' },
  dirLeft:   { left:  (Dimensions.get('window').width  / 2 - OUTER / 2 - 28) },
  dirRight:  { right: (Dimensions.get('window').width  / 2 - OUTER / 2 - 28) },
  dirFwd:    { color: colors.success },
  dirRev:    { color: colors.danger },
  dirSide:   { color: colors.primary },

  // Outer circle
  outerCircle: {
    width:           OUTER,
    height:          OUTER,
    borderRadius:    OUTER / 2,
    backgroundColor: '#111',
    borderWidth:     2,
    borderColor:     colors.border,
    alignItems:      'center',
    justifyContent:  'center',
    overflow:        'hidden',
  },
  outerDisabled: { opacity: 0.35 },

  crossH: { position: 'absolute', width: '100%', height: 1, backgroundColor: '#222' },
  crossV: { position: 'absolute', width: 1, height: '100%', backgroundColor: '#222' },

  knob: {
    position:        'absolute',
    width:           KNOB,
    height:          KNOB,
    borderRadius:    KNOB / 2,
    backgroundColor: '#1e1e1e',
    borderWidth:     2,
    borderColor:     colors.border,
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 3 },
    shadowOpacity:   0.6,
    shadowRadius:    5,
    elevation:       8,
  },
  knobActive:   { borderColor: colors.primary, backgroundColor: colors.primaryDark },
  knobDisabled: { borderColor: '#333' },

  // Values row
  valRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    marginTop:      spacing.md,
    gap:            spacing.lg,
  },
  valBox:  { alignItems: 'center', minWidth: 64 },
  valSep:  { width: 1, height: 32, backgroundColor: colors.border },
  valLabel:{ fontSize: 10, color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase' },
  valNum:  { fontSize: 26, fontWeight: 'bold', fontVariant: ['tabular-nums'] },
  valUnit: { fontSize: 12, fontWeight: 'normal', color: colors.textMuted },

  hint: {
    fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs,
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: spacing.md,
    paddingBottom:     spacing.md,
    gap:               spacing.xs,
  },
  eStopBtn: {
    backgroundColor: colors.danger, borderRadius: 12,
    padding: spacing.md, alignItems: 'center',
  },
  eStopActive: { backgroundColor: '#7d1f1f', borderWidth: 2, borderColor: colors.danger },
  eStopText:   { color: colors.white, fontSize: 16, fontWeight: 'bold' },

  resetBtn: {
    borderRadius: 10, padding: spacing.sm, alignItems: 'center',
    borderWidth: 1, borderColor: colors.success, backgroundColor: colors.surfaceAlt,
  },
  resetText: { color: colors.success, fontSize: 13, fontWeight: '600' },
});
