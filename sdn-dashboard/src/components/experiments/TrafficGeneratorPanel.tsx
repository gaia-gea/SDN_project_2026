import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowRight,
  CheckCircle,
  History,
  Play,
  Radio,
  RefreshCw,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react'

import { checkAgentHealth } from '@/services/rpiAgent'
import { useNetworkStore } from '@/stores/networkStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTrafficStore } from '@/stores/trafficStore'
import type { TrafficParams, TrafficType } from '@/types'

const inputClass =
  'w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-200 outline-none focus:border-sdn-500 disabled:opacity-40'

const resultValue = (value: number | null | undefined, unit: string) =>
  value === undefined || value === null ? '—' : `${value} ${unit}`

export const TrafficGeneratorPanel = () => {
  const devices = useNetworkStore((state) => state.devices)
  const rpiAgents = useSettingsStore((state) => state.rpiAgents)

  const status = useTrafficStore((state) => state.status)
  const activeJob = useTrafficStore((state) => state.activeJob)
  const latestResult = useTrafficStore((state) => state.latestResult)
  const history = useTrafficStore((state) => state.history)
  const error = useTrafficStore((state) => state.error)
  const startJob = useTrafficStore((state) => state.startJob)
  const refreshResult = useTrafficStore((state) => state.refreshResult)
  const stopJob = useTrafficStore((state) => state.stopJob)
  const clearError = useTrafficStore((state) => state.clearError)
  const clearHistory = useTrafficStore((state) => state.clearHistory)

  const destinationHosts = useMemo(
    () =>
      devices.filter(
        (device) =>
          device.type === 'host' &&
          device.status === 'online' &&
          Boolean(device.ipAddress),
      ),
    [devices],
  )

  // Every online host with an ONOS-discovered IP can be a source. Settings
  // supplies only an optional management-address override for its agent.
  const sourceHosts = destinationHosts

  const [sourceId, setSourceId] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [trafficType, setTrafficType] = useState<TrafficType>('ping')
  const [destinationPort, setDestinationPort] = useState(5201)
  const [bandwidthMbps, setBandwidthMbps] = useState(10)
  const [durationSec, setDurationSec] = useState(10)
  const [streams, setStreams] = useState(1)
  const [agentTest, setAgentTest] = useState<string | null>(null)
  const [isTestingAgent, setIsTestingAgent] = useState(false)

  const isBusy = ['starting', 'running', 'stopping'].includes(status)
  const isRunning = status === 'running'

  useEffect(() => {
    if (!sourceHosts.some((host) => host.id === sourceId)) {
      setSourceId(sourceHosts[0]?.id ?? '')
    }
  }, [sourceHosts, sourceId])

  useEffect(() => {
    const validDestinations = destinationHosts.filter((host) => host.id !== sourceId)
    if (!validDestinations.some((host) => host.id === destinationId)) {
      setDestinationId(validDestinations[0]?.id ?? '')
    }
  }, [destinationHosts, destinationId, sourceId])

  useEffect(() => {
    if (!isRunning) return

    void refreshResult()
    const timer = window.setInterval(() => void refreshResult(), 2_000)
    return () => window.clearInterval(timer)
  }, [isRunning, refreshResult])

  const source = destinationHosts.find((host) => host.id === sourceId)
  const destination = destinationHosts.find((host) => host.id === destinationId)
  const sourceAgentOverride = source ? rpiAgents[source.id]?.trim() : undefined
  const sourceAgentAddress = sourceAgentOverride || source?.ipAddress

  const elapsed = latestResult?.elapsed_sec ?? 0
  const runDuration = activeJob?.params.duration ?? durationSec
  const progress = runDuration > 0 ? Math.min(100, (elapsed / runDuration) * 100) : 0
  const feedbackIsError = Boolean(
    error || (agentTest && !agentTest.startsWith('Agent reachable')),
  )

  const handleStart = async () => {
    clearError()
    setAgentTest(null)

    if (!source || !sourceAgentAddress) return
    if (!destination || source.id === destination.id) return

    const params: TrafficParams = {
      type: trafficType,
      target: destination.ipAddress,
      duration: durationSec,
      ...(trafficType !== 'ping' && {
        dst_port: destinationPort,
        streams,
      }),
      ...(trafficType === 'udp' && { bw: bandwidthMbps }),
    }

    await startJob({
      sourceDeviceId: source.id,
      sourceLabel: source.label,
      sourceAgentAddress,
      destinationDeviceId: destination.id,
      destinationLabel: destination.label,
      params,
    })
  }

  const handleTestAgent = async () => {
    if (!sourceAgentAddress) return

    setIsTestingAgent(true)
    setAgentTest(null)
    clearError()

    try {
      const health = await checkAgentHealth(sourceAgentAddress)
      setAgentTest(
        `Agent reachable${health.hostname ? ` (${health.hostname})` : ''}; ${health.running ? 'job running' : 'idle'}.`,
      )
    } catch (healthError) {
      setAgentTest(healthError instanceof Error ? healthError.message : 'Agent health check failed.')
    } finally {
      setIsTestingAgent(false)
    }
  }

  return (
    <div className="glass-card p-4 mb-4">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-sdn-400" />
            <h2 className="text-sm font-semibold text-slate-100">Traffic Generator</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Start ping or iperf3 on a configured Mininet/Raspberry Pi agent
          </p>
        </div>

        <span className={status === 'failed' ? 'badge badge-red' : isBusy ? 'badge badge-green' : 'badge badge-blue'}>
          <span className={isBusy ? 'w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse' : 'w-1.5 h-1.5 rounded-full bg-slate-400'} />
          {status}
        </span>
      </div>

      {sourceHosts.length === 0 && (
        <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-300">
          No online host with an IP address has been discovered yet. Start demo mode or connect ONOS first.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto_1fr] gap-4">
        <div>
          <label className="metric-label block mb-1.5">Source host (agent)</label>
          <select
            value={sourceId}
            disabled={isBusy}
            onChange={(event) => {
              setSourceId(event.target.value)
              setAgentTest(null)
            }}
            className={inputClass}
          >
            <option value="">Select source</option>
            {sourceHosts.map((host) => (
              <option key={host.id} value={host.id}>
                {host.label} — {rpiAgents[host.id]?.trim() || host.ipAddress}
                {rpiAgents[host.id]?.trim() ? ' (override)' : ' (automatic)'}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end justify-center pb-2">
          <ArrowRight className="w-5 h-5 text-slate-500" />
        </div>

        <div>
          <label className="metric-label block mb-1.5">Destination host</label>
          <select
            value={destinationId}
            disabled={isBusy}
            onChange={(event) => setDestinationId(event.target.value)}
            className={inputClass}
          >
            <option value="">Select destination</option>
            {destinationHosts
              .filter((host) => host.id !== sourceId)
              .map((host) => (
                <option key={host.id} value={host.id}>
                  {host.label} — {host.ipAddress}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-4">
        <div>
          <label className="metric-label block mb-1.5">Traffic type</label>
          <select
            value={trafficType}
            disabled={isBusy}
            onChange={(event) => setTrafficType(event.target.value as TrafficType)}
            className={inputClass}
          >
            <option value="ping">ICMP Ping</option>
            <option value="tcp">TCP Bulk</option>
            <option value="udp">UDP Constant</option>
          </select>
        </div>

        <div>
          <label className="metric-label block mb-1.5">Destination port</label>
          <input
            type="number"
            min={1}
            max={65535}
            value={destinationPort}
            disabled={isBusy || trafficType === 'ping'}
            onChange={(event) => setDestinationPort(Number(event.target.value))}
            className={inputClass}
          />
        </div>

        <div>
          <label className="metric-label block mb-1.5">Bandwidth (Mbps)</label>
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={bandwidthMbps}
            disabled={isBusy || trafficType !== 'udp'}
            onChange={(event) => setBandwidthMbps(Number(event.target.value))}
            className={inputClass}
          />
        </div>

        <div>
          <label className="metric-label block mb-1.5">Duration (s)</label>
          <input
            type="number"
            min={1}
            max={3600}
            value={durationSec}
            disabled={isBusy}
            onChange={(event) => setDurationSec(Number(event.target.value))}
            className={inputClass}
          />
        </div>

        <div>
          <label className="metric-label block mb-1.5">Parallel streams</label>
          <input
            type="number"
            min={1}
            max={32}
            value={streams}
            disabled={isBusy || trafficType === 'ping'}
            onChange={(event) => setStreams(Number(event.target.value))}
            className={inputClass}
          />
        </div>
      </div>

      {activeJob && (
        <div className="mt-4 rounded-lg border border-sdn-500/20 bg-sdn-500/5 p-3">
          <div className="flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-300">
              <Activity className="w-4 h-4 text-sdn-400 animate-pulse" />
              <span>{activeJob.sourceLabel} → {activeJob.destinationLabel}</span>
              <span className="text-slate-500">{activeJob.params.type.toUpperCase()}</span>
            </div>
            <span className="font-mono text-slate-400">{elapsed.toFixed(1)}s / {runDuration}s</span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mt-3">
            <div className="h-full bg-sdn-500 transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {latestResult?.done && latestResult.status === 'completed' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <div className="bg-slate-800/60 rounded-lg p-3">
            <p className="metric-label">Throughput</p>
            <p className="metric-value text-lg">{resultValue(latestResult.throughput_mbps, 'Mbps')}</p>
          </div>
          <div className="bg-slate-800/60 rounded-lg p-3">
            <p className="metric-label">Average RTT</p>
            <p className="metric-value text-lg">{resultValue(latestResult.avg_rtt_ms, 'ms')}</p>
          </div>
          <div className="bg-slate-800/60 rounded-lg p-3">
            <p className="metric-label">Jitter</p>
            <p className="metric-value text-lg">{resultValue(latestResult.jitter_ms, 'ms')}</p>
          </div>
          <div className="bg-slate-800/60 rounded-lg p-3">
            <p className="metric-label">Packet loss</p>
            <p className="metric-value text-lg">
              {resultValue(latestResult.lost_pct ?? latestResult.packet_loss_pct, '%')}
            </p>
          </div>
        </div>
      )}

      {(error || agentTest) && (
        <div className={`mt-3 flex items-start gap-2 rounded-lg border p-3 text-xs ${feedbackIsError ? 'border-red-500/20 bg-red-500/10 text-red-300' : 'border-green-500/20 bg-green-500/10 text-green-300'}`}>
          {feedbackIsError ? <XCircle className="w-4 h-4 flex-shrink-0" /> : <CheckCircle className="w-4 h-4 flex-shrink-0" />}
          <span>{error ?? agentTest}</span>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 mt-4">
        <button
          type="button"
          onClick={() => void handleTestAgent()}
          disabled={!sourceAgentAddress || isBusy || isTestingAgent}
          className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-40"
        >
          <RefreshCw className={`w-4 h-4 ${isTestingAgent ? 'animate-spin' : ''}`} />
          Test agent
        </button>

        {status === 'starting' ? (
          <button
            type="button"
            disabled
            className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm font-medium text-green-400 opacity-60"
          >
            <RefreshCw className="w-4 h-4 animate-spin" />
            Starting…
          </button>
        ) : status === 'running' || status === 'stopping' ? (
          <button
            type="button"
            onClick={() => void stopJob()}
            disabled={status === 'stopping'}
            className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-40"
          >
            <Square className="w-4 h-4" />
            {status === 'stopping' ? 'Stopping…' : 'Stop'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleStart()}
            disabled={!source || !destination || source.id === destination.id}
            className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm font-medium text-green-400 hover:bg-green-500/20 disabled:opacity-40"
          >
            <Play className="w-4 h-4" />
            Start
          </button>
        )}
      </div>

      {history.length > 0 && (
        <div className="mt-5 border-t border-slate-700/50 pt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
              <History className="w-4 h-4 text-slate-500" />
              Recent runs
            </div>
            <button
              type="button"
              onClick={clearHistory}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-400"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear
            </button>
          </div>
          <div className="space-y-1">
            {history.slice(0, 5).map((entry) => (
              <div key={entry.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-lg bg-slate-800/40 px-3 py-2 text-xs">
                <span className="text-slate-300">
                  {entry.job.sourceLabel} → {entry.job.destinationLabel} · {entry.job.params.type.toUpperCase()}
                </span>
                <span className={entry.status === 'completed' ? 'text-green-400' : entry.status === 'failed' ? 'text-red-400' : 'text-amber-400'}>
                  {entry.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
