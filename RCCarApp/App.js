/**
 * App.js — Root component.
 *
 * Wraps the app in AppProvider (global state + WebSocket) and sets up
 * the bottom-tab navigator with all five screens.
 */

import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';

import { AppProvider } from './context/AppContext';
import ConnectionScreen  from './screens/ConnectionScreen';
import ManualControlScreen from './screens/ManualControlScreen';
import TelemetryScreen   from './screens/TelemetryScreen';
import RaceAnalysisScreen from './screens/RaceAnalysisScreen';
import LogScreen         from './screens/LogScreen';
import { colors } from './styles/theme';

const Tab = createBottomTabNavigator();

// Icon mapping for each tab.
const TAB_ICONS = {
  Connect:  ['wifi',            'wifi-outline'],
  Control:  ['game-controller', 'game-controller-outline'],
  Telemetry:['pulse',           'pulse-outline'],
  Analysis: ['bar-chart',       'bar-chart-outline'],
  Logs:     ['list',            'list-outline'],
};

export default function App() {
  return (
    // GestureHandlerRootView is required by react-native-gesture-handler.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppProvider>
        <NavigationContainer>
          <StatusBar style="light" />
          <Tab.Navigator
            screenOptions={({ route }) => ({
              // Tab bar icons
              tabBarIcon: ({ focused, color, size }) => {
                const [active, inactive] = TAB_ICONS[route.name] ?? ['help', 'help-outline'];
                return <Ionicons name={focused ? active : inactive} size={size} color={color} />;
              },
              // Colours
              tabBarActiveTintColor:   colors.primary,
              tabBarInactiveTintColor: colors.textMuted,
              // Tab bar style
              tabBarStyle: {
                backgroundColor: colors.surface,
                borderTopColor:  colors.border,
              },
              // Header style
              headerStyle:      { backgroundColor: colors.background },
              headerTintColor:  colors.text,
              headerTitleStyle: { fontWeight: 'bold' },
            })}
          >
            <Tab.Screen
              name="Connect"
              component={ConnectionScreen}
              options={{ title: 'Connection' }}
            />
            <Tab.Screen
              name="Control"
              component={ManualControlScreen}
              options={{ title: 'Control' }}
            />
            <Tab.Screen
              name="Telemetry"
              component={TelemetryScreen}
              options={{ title: 'Telemetry' }}
            />
            <Tab.Screen
              name="Analysis"
              component={RaceAnalysisScreen}
              options={{ title: 'Race Analysis' }}
            />
            <Tab.Screen
              name="Logs"
              component={LogScreen}
              options={{ title: 'Event Logs' }}
            />
          </Tab.Navigator>
        </NavigationContainer>
      </AppProvider>
    </GestureHandlerRootView>
  );
}
