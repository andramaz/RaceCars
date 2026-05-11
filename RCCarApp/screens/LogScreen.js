/**
 * LogScreen.js
 *
 * Scrollable list of all events: commands sent, emergency stop,
 * fail-safe activations, connection events, and errors.
 * Entries are stored in AppContext (newest first, max 150).
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { colors, spacing } from '../styles/theme';

// Map log type → text colour.
const TYPE_COLOR = {
  info:      colors.text,
  command:   colors.primary,
  emergency: colors.danger,
  failsafe:  colors.warning,
  error:     colors.danger,
};

// ── Single log entry ─────────────────────────────────────────────────────

function LogEntry({ item }) {
  return (
    <View style={styles.entry}>
      <Text style={styles.entryTime}>{item.timestamp}</Text>
      <Text
        style={[styles.entryMsg, { color: TYPE_COLOR[item.type] ?? colors.text }]}
        numberOfLines={2}
      >
        {item.message}
      </Text>
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────

export default function LogScreen() {
  const { logs, clearLogs } = useApp();

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Event Log</Text>
          <Text style={styles.count}>{logs.length} entries (max 150)</Text>
        </View>
        <TouchableOpacity
          style={styles.clearBtn}
          onPress={clearLogs}
          disabled={logs.length === 0}
          activeOpacity={0.75}
        >
          <Text style={[styles.clearText, logs.length === 0 && styles.clearDisabled]}>
            Clear
          </Text>
        </TouchableOpacity>
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <Text style={[styles.legendDot, { color: colors.primary }]}>● CMD</Text>
        <Text style={[styles.legendDot, { color: colors.danger }]}>● EMERGENCY</Text>
        <Text style={[styles.legendDot, { color: colors.warning }]}>● FAIL-SAFE</Text>
        <Text style={[styles.legendDot, { color: colors.text }]}>● INFO</Text>
      </View>

      {/* Empty state */}
      {logs.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyTitle}>No events yet</Text>
          <Text style={styles.emptyHint}>Connect to the backend and send some commands.</Text>
        </View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={item => String(item.id)}
          renderItem={({ item }) => <LogEntry item={item} />}
          style={styles.list}
          initialNumToRender={40}
          maxToRenderPerBatch={20}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection:    'row',
    justifyContent:   'space-between',
    alignItems:       'center',
    padding:          spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title:   { fontSize: 20, fontWeight: 'bold', color: colors.text },
  count:   { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  clearBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical:   spacing.xs,
    borderRadius:      6,
    borderWidth:       1,
    borderColor:       colors.border,
  },
  clearText:     { fontSize: 13, color: colors.danger, fontWeight: '500' },
  clearDisabled: { color: colors.textMuted },

  legend: {
    flexDirection: 'row',
    gap:            spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexWrap:          'wrap',
  },
  legendDot: { fontSize: 11 },

  list: { flex: 1 },

  entry: {
    flexDirection:    'row',
    paddingHorizontal: spacing.md,
    paddingVertical:   6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '55',
    gap:               spacing.sm,
    alignItems:        'flex-start',
  },
  entryTime: {
    fontSize:    11,
    color:       colors.textMuted,
    width:       72,
    paddingTop:  1,
    flexShrink:  0,
  },
  entryMsg: {
    flex:       1,
    fontSize:   13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 19,
  },

  empty:     { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyTitle:{ fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  emptyHint: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
});
