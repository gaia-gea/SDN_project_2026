import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppSettings, ConnectionSettings, DashboardSettings } from '@/types'

const DEFAULT_SETTINGS: AppSettings = {
  connection: {
    onosHost: '10.42.0.220',
    onosPort: 8181,
    onosUser: 'onos',
    onosPassword: 'rocks',
    wsHost: 'localhost',
    wsPort: 8765,
    wsPath: '/ws/metrics',
    useSSL: false,
  },
  dashboard: {
    metricsWindowSec: 60,
    metricsIntervalMs: 1000,
    topologyRefreshSec: 30,
    maxAlerts: 200,
    theme: 'dark',
    defaultLayout: 'force',
  },
  // Optional overrides only. Without one, the dashboard uses the host IP
  // discovered by ONOS and stored in networkStore.
  rpiAgents: {},
}

const LEGACY_MININET_AGENT_DEFAULTS: Record<string, string> = {
  'h-1': '10.0.0.1',
  'h-2': '10.0.0.2',
  'h-3': '10.0.0.3',
  'h-4': '10.0.0.4',
  'h-5': '10.0.0.5',
}

interface SettingsState extends AppSettings {
  updateConnection: (partial: Partial<ConnectionSettings>) => void
  updateDashboard: (partial: Partial<DashboardSettings>) => void
  updateRpiAgent: (deviceId: string, address: string) => void
  removeRpiAgent: (deviceId: string) => void
  resetToDefaults: () => void
  getWsUrl: () => string
  getOnosBaseUrl: () => string
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,

      updateConnection: (partial) =>
        set((state) => ({ connection: { ...state.connection, ...partial } })),

      updateDashboard: (partial) =>
        set((state) => ({ dashboard: { ...state.dashboard, ...partial } })),

      updateRpiAgent: (deviceId, address) =>
        set((state) => ({
          rpiAgents: {
            ...state.rpiAgents,
            [deviceId]: address.trim(),
          },
        })),

      removeRpiAgent: (deviceId) =>
        set((state) => {
          const rpiAgents = { ...state.rpiAgents }
          delete rpiAgents[deviceId]
          return { rpiAgents }
        }),

      resetToDefaults: () => set(DEFAULT_SETTINGS),

      getWsUrl: () => {
        const { connection } = get()
        const proto = connection.useSSL ? 'wss' : 'ws'
        return `${proto}://${connection.wsHost}:${connection.wsPort}${connection.wsPath}`
      },

      getOnosBaseUrl: () => {
        const { connection } = get()
        const proto = connection.useSSL ? 'https' : 'http'
        return `${proto}://${connection.onosHost}:${connection.onosPort}`
      },
    }),
    {
      name: 'sdn-dashboard-settings',
      version: 1,
      migrate: (persistedState, version) => {
        const state = persistedState as Partial<SettingsState>

        // Version 0 briefly stored Mininet addresses as if they were required
        // configuration. Remove only those exact legacy values; the automatic
        // fallback to host.ipAddress preserves the same Mininet behaviour.
        if (version === 0 && state.rpiAgents) {
          const rpiAgents = Object.fromEntries(
            Object.entries(state.rpiAgents).filter(
              ([deviceId, address]) =>
                LEGACY_MININET_AGENT_DEFAULTS[deviceId] !== address,
            ),
          )
          return { ...state, rpiAgents } as SettingsState
        }

        return state as SettingsState
      },
      partialize: (state) => ({
        connection: state.connection,
        dashboard: state.dashboard,
        rpiAgents: state.rpiAgents,
      }),
    },
  ),
)
