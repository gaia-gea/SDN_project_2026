import { create } from 'zustand'

import {
  pollTrafficResult,
  startTraffic,
  stopTraffic,
} from '@/services/rpiAgent'
import type {
  ActiveTrafficJob,
  TrafficAgentResult,
  TrafficHistoryEntry,
  TrafficParams,
  TrafficRunStatus,
} from '@/types'

const MAX_HISTORY_ENTRIES = 50

interface StartTrafficInput {
  sourceDeviceId: string
  sourceLabel: string
  sourceAgentAddress: string
  destinationDeviceId: string
  destinationLabel: string
  params: TrafficParams
}

interface TrafficState {
  status: TrafficRunStatus
  activeJob: ActiveTrafficJob | null
  latestResult: TrafficAgentResult | null
  history: TrafficHistoryEntry[]
  error: string | null
  isPolling: boolean

  startJob: (input: StartTrafficInput) => Promise<boolean>
  refreshResult: () => Promise<void>
  stopJob: () => Promise<void>
  clearError: () => void
  clearHistory: () => void
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unexpected traffic generator error'

const addHistoryEntry = (
  history: TrafficHistoryEntry[],
  job: ActiveTrafficJob,
  status: TrafficHistoryEntry['status'],
  result: TrafficAgentResult,
): TrafficHistoryEntry[] => [
  {
    id: `${job.id}-${status}`,
    job,
    status,
    result,
    completedAt: new Date().toISOString(),
  },
  ...history,
].slice(0, MAX_HISTORY_ENTRIES)

export const useTrafficStore = create<TrafficState>()((set, get) => ({
  status: 'idle',
  activeJob: null,
  latestResult: null,
  history: [],
  error: null,
  isPolling: false,

  startJob: async (input) => {
    if (get().activeJob) {
      set({ error: 'Another traffic job is already active.' })
      return false
    }

    const job: ActiveTrafficJob = {
      id: `traffic-${Date.now()}`,
      ...input,
      startedAt: new Date().toISOString(),
    }

    set({
      status: 'starting',
      activeJob: job,
      latestResult: null,
      error: null,
    })

    try {
      await startTraffic(input.sourceAgentAddress, input.params)
      set({ status: 'running' })
      return true
    } catch (error) {
      const result: TrafficAgentResult = {
        done: true,
        status: 'failed',
        error: errorMessage(error),
      }

      set((state) => ({
        status: 'failed',
        activeJob: null,
        latestResult: result,
        error: result.error ?? 'Failed to start traffic',
        history: addHistoryEntry(state.history, job, 'failed', result),
      }))
      return false
    }
  },

  refreshResult: async () => {
    const { activeJob, status, isPolling } = get()
    if (!activeJob || status !== 'running' || isPolling) return

    set({ isPolling: true })

    try {
      const result = await pollTrafficResult(activeJob.sourceAgentAddress)

      if (!result.done) {
        set({ latestResult: result, error: null, isPolling: false })
        return
      }

      if (result.status === 'completed') {
        set((state) => ({
          status: 'completed',
          activeJob: null,
          latestResult: result,
          error: null,
          isPolling: false,
          history: addHistoryEntry(state.history, activeJob, 'completed', result),
        }))
        return
      }

      const failedResult: TrafficAgentResult = {
        ...result,
        status: 'failed',
        error: result.error ?? `Agent finished with status ${result.status}`,
      }

      set((state) => ({
        status: 'failed',
        activeJob: null,
        latestResult: failedResult,
        error: failedResult.error ?? 'Traffic job failed',
        isPolling: false,
        history: addHistoryEntry(state.history, activeJob, 'failed', failedResult),
      }))
    } catch (error) {
      set({
        error: errorMessage(error),
        isPolling: false,
      })
    }
  },

  stopJob: async () => {
    const activeJob = get().activeJob
    if (!activeJob) return

    set({ status: 'stopping', error: null })

    try {
      await stopTraffic(activeJob.sourceAgentAddress)
      const result: TrafficAgentResult = {
        done: true,
        status: 'stopped',
      }

      set((state) => ({
        status: 'stopped',
        activeJob: null,
        latestResult: result,
        history: addHistoryEntry(state.history, activeJob, 'stopped', result),
      }))
    } catch (error) {
      set({
        status: 'running',
        error: errorMessage(error),
      })
    }
  },

  clearError: () => set({ error: null }),
  clearHistory: () => set({ history: [] }),
}))
