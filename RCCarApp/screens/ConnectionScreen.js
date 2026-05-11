/**
 * ConnectionScreen.js
 *
 * Lets the user enter the backend WebSocket URL, connect, disconnect,
 * and see live connection status + signal quality.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { colors, spacing, card } from '../styles/theme';

export default function ConnectionScreen() {
  const { wsUrl, setWsUrl, connected, connect, disconnect, signalQuality, lastUpdate } = useApp();

  // Local input state — only committed to context on "Connect".
  const [inputUrl, setInputUrl] = useState(wsUrl);

  const handleConnect = () => {
    const trimmed = inputUrl.trim();
    setWsUrl(trimmed);
    connect(trimmed);
  };

  const signalColor = {
    good:   colors.success,
    medium: colors.warning,
    poor:   colors.danger,
  }[signalQuality] ?? colors.textMuted;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        <Text style={styles.title}>RC Car Connection</Text>
        <Text style={styles.subtitle}>
          Connect your phone to the FastAPI backend running on your PC.
        </Text>

        {/* ── Status card ───────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Status</Text>

          <View style={styles.row}>
            <View style={[styles.dot, { backgroundColor: connected ? colors.success : colors.danger }]} />
            <Text style={[styles.statusText, { color: connected ? colors.success : colors.danger }]}>
              {connected ? 'Connected' : 'Disconnected'}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Signal Quality</Text>
            <Text style={[styles.value, { color: signalColor }]}>
              {signalQuality === '--' ? '—' : signalQuality.toUpperCase()}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Last Update</Text>
            <Text style={styles.value}>{lastUpdate ?? '—'}</Text>
          </View>
        </View>

        {/* ── URL input ─────────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Backend WebSocket URL</Text>
          <Text style={styles.hint}>
            Both your phone and PC must be on the same Wi-Fi network.{'\n'}
            Find your PC's local IP with:{'\n'}
            {'  '}Windows → <Text style={styles.code}>ipconfig</Text>
            {'   '}Mac/Linux → <Text style={styles.code}>ifconfig</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={inputUrl}
            onChangeText={setInputUrl}
            placeholder="ws://192.168.1.10:8000/ws"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </View>

        {/* ── Action buttons ────────────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.btn, connected ? styles.btnDisabled : styles.btnPrimary]}
          onPress={handleConnect}
          disabled={connected}
          activeOpacity={0.75}
        >
          <Text style={styles.btnText}>Connect</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, !connected ? styles.btnDisabled : styles.btnDanger]}
          onPress={disconnect}
          disabled={!connected}
          activeOpacity={0.75}
        >
          <Text style={styles.btnText}>Disconnect</Text>
        </TouchableOpacity>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:       { flex: 1, backgroundColor: colors.background },
  scroll:     { padding: spacing.md },
  title:      { fontSize: 24, fontWeight: 'bold', color: colors.text, marginBottom: spacing.xs },
  subtitle:   { fontSize: 13, color: colors.textMuted, marginBottom: spacing.lg, lineHeight: 20 },
  card:       { ...card },
  cardTitle:  { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },
  row:        { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  dot:        { width: 12, height: 12, borderRadius: 6, marginRight: spacing.sm },
  statusText: { fontSize: 16, fontWeight: '600' },
  infoRow:    { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  label:      { fontSize: 14, color: colors.textMuted },
  value:      { fontSize: 14, fontWeight: '500', color: colors.text },
  hint:       { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 19 },
  code:       { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: colors.primary },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius:    8,
    padding:         spacing.sm,
    color:           colors.text,
    fontSize:        14,
    borderWidth:     1,
    borderColor:     colors.border,
  },
  btn: {
    borderRadius:   10,
    padding:        spacing.md,
    alignItems:     'center',
    marginBottom:   spacing.sm,
  },
  btnPrimary:  { backgroundColor: colors.primaryDark },
  btnDanger:   { backgroundColor: colors.danger },
  btnDisabled: { backgroundColor: colors.surfaceAlt },
  btnText:     { color: colors.white, fontSize: 16, fontWeight: '600' },
});
