import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowRight,
  Play,
  Radio,
  Square,
} from 'lucide-react'

import { useNetworkStore } from '@/stores/networkStore'

type TrafficType = 'ping' | 'tcp' | 'udp'

export const TrafficGeneratorPanel = () => {
  const devices = useNetworkStore((state) => state.devices)

  const hosts = useMemo(
    () =>
      devices.filter(
        (device) =>
          device.type === 'host' &&
          device.status === 'online' &&
          device.ipAddress,
      ),
    [devices],
  )

  const [sourceId, setSourceId] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [trafficType, setTrafficType] =
    useState<TrafficType>('ping')

  const [destinationPort, setDestinationPort] =
    useState(5201)

  const [bandwidthMbps, setBandwidthMbps] =
    useState(10)

  const [durationSec, setDurationSec] =
    useState(10)

  const [streams, setStreams] = useState(1)
  const [isRunning, setIsRunning] = useState(false)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!sourceId && hosts[0]) {
      setSourceId(hosts[0].id)
    }

    if (!destinationId && hosts[1]) {
      setDestinationId(hosts[1].id)
    }
  }, [hosts, sourceId, destinationId])

  useEffect(() => {
    if (!isRunning) return

    const timer = window.setInterval(() => {
      setElapsedSec((current) => {
        if (current >= durationSec) {
          setIsRunning(false)
          setMessage(
            'Simulación visual terminada. El agente todavía no está conectado.',
          )
          return durationSec
        }

        return current + 1
      })
    }, 1000)

    return () => window.clearInterval(timer)
  }, [isRunning, durationSec])

  const source = hosts.find(
    (host) => host.id === sourceId,
  )

  const destination = hosts.find(
    (host) => host.id === destinationId,
  )

  const progress =
    durationSec > 0
      ? Math.min(100, (elapsedSec / durationSec) * 100)
      : 0

  const handleStart = () => {
    setMessage(null)

    if (!source || !destination) {
      setMessage('Select a source and destination host.')
      return
    }

    if (source.id === destination.id) {
      setMessage(
        'Source and destination must be different hosts.',
      )
      return
    }

    setElapsedSec(0)
    setIsRunning(true)
  }

  const handleStop = () => {
    setIsRunning(false)
    setMessage('Traffic generation stopped.')
  }

  return (
    <div className="glass-card p-4 mb-4">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-sdn-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              Traffic Generator
            </h2>
          </div>

          <p className="text-xs text-slate-400 mt-1">
            Generate traffic between Mininet or physical hosts
          </p>
        </div>

        <span
          className={
            isRunning
              ? 'badge badge-green'
              : 'badge badge-blue'
          }
        >
          <span
            className={
              isRunning
                ? 'w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse'
                : 'w-1.5 h-1.5 rounded-full bg-slate-400'
            }
          />

          {isRunning ? 'Running' : 'Idle'}
        </span>
      </div>

      {hosts.length < 2 && (
        <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-300">
          At least two online hosts with IP addresses are required.
          In demo mode, wait for the simulated topology to load.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div>
          <label className="metric-label block mb-1.5">
            Source host
          </label>

          <select
            value={sourceId}
            disabled={isRunning}
            onChange={(event) =>
              setSourceId(event.target.value)
            }
            className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-200 outline-none focus:border-sdn-500"
          >
            <option value="">Select source</option>

            {hosts.map((host) => (
              <option key={host.id} value={host.id}>
                {host.label} — {host.ipAddress}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end justify-center pb-2">
          <ArrowRight className="w-5 h-5 text-slate-500" />
        </div>

        <div>
          <label className="metric-label block mb-1.5">
            Destination host
          </label>

          <select
            value={destinationId}
            disabled={isRunning}
            onChange={(event) =>
              setDestinationId(event.target.value)
            }
            className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-200 outline-none focus:border-sdn-500"
          >
            <option value="">Select destination</option>

            {hosts
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
          <label className="metric-label block mb-1.5">
            Traffic type
          </label>

          <select
            value={trafficType}
            disabled={isRunning}
            onChange={(event) =>
              setTrafficType(
                event.target.value as TrafficType,
              )
            }
            className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-200 outline-none focus:border-sdn-500"
          >
            <option value="ping">ICMP Ping</option>
            <option value="tcp">TCP Bulk</option>
            <option value="udp">UDP Constant</option>
          </select>
        </div>

        <div>
          <label className="metric-label block mb-1.5">
            Destination port
          </label>

          <input
            type="number"
            min={1}
            max={65535}
            value={destinationPort}
            disabled={isRunning || trafficType === 'ping'}
            onChange={(event) =>
              setDestinationPort(
                Number(event.target.value),
              )
            }
            className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-200 outline-none focus:border-sdn-500 disabled:opacity-40"
          />
        </div>

        <div>
          <label className="metric-label block mb-1.5">
            Bandwidth
          </label>

          <div className="relative">
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={bandwidthMbps}
              disabled={isRunning || trafficType !== 'udp'}
              onChange={(event) =>
                setBandwidthMbps(
                  Number(event.target.value),
                )
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 pr-14 text-sm text-slate-200 outline-none focus:border-sdn-500 disabled:opacity-40"
            />

            <span className="absolute right-3 top-2.5 text-xs text-slate-500">
              Mbps
            </span>
          </div>
        </div>

        <div>
          <label className="metric-label block mb-1.5">
            Duration
          </label>

          <div className="relative">
            <input
              type="number"
              min={1}
              max={3600}
              value={durationSec}
              disabled={isRunning}
              onChange={(event) =>
                setDurationSec(Number(event.target.value))
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 pr-9 text-sm text-slate-200 outline-none focus:border-sdn-500"
            />

            <span className="absolute right-3 top-2.5 text-xs text-slate-500">
              s
            </span>
          </div>
        </div>

        <div>
          <label className="metric-label block mb-1.5">
            Parallel streams
          </label>

          <input
            type="number"
            min={1}
            max={32}
            value={streams}
            disabled={isRunning || trafficType === 'ping'}
            onChange={(event) =>
              setStreams(Number(event.target.value))
            }
            className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-200 outline-none focus:border-sdn-500 disabled:opacity-40"
          />
        </div>
      </div>

      {isRunning && (
        <div className="mt-4 rounded-lg border border-sdn-500/20 bg-sdn-500/5 p-3">
          <div className="flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-300">
              <Activity className="w-4 h-4 text-sdn-400 animate-pulse" />

              <span>
                {source?.label} → {destination?.label}
              </span>

              <span className="text-slate-500">
                {trafficType.toUpperCase()}
              </span>
            </div>

            <span className="font-mono text-slate-400">
              {elapsedSec}s / {durationSec}s
            </span>
          </div>

          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mt-3">
            <div
              className="h-full bg-sdn-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {message && (
        <p className="mt-3 text-xs text-amber-300">
          {message}
        </p>
      )}

      <div className="flex justify-end gap-2 mt-4">
        {isRunning ? (
          <button
            type="button"
            onClick={handleStop}
            className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20"
          >
            <Square className="w-4 h-4" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStart}
            disabled={hosts.length < 2}
            className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm font-medium text-green-400 hover:bg-green-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Play className="w-4 h-4" />
            Start
          </button>
        )}
      </div>
    </div>
  )
}