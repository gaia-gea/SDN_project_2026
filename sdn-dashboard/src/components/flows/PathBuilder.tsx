import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, X, Zap, RotateCcw } from 'lucide-react'
import { useNetworkStore } from '@/stores/networkStore'
import { useFlowStore } from '@/stores/flowStore'
import { useSliceStore } from '@/stores/sliceStore'
import { colorClasses } from './SliceBar'
import type { FlowRule, SliceColor } from '@/types'
import { clsx } from 'clsx'
import { addFlow as pushFlowToOnos } from '@/services/onosApi'

interface PathBuilderProps {
  srcId: string | null
  dstId: string | null
  viaIds: string[]
  onReset: () => void
  onCancel: () => void
  selectedSliceId: string | null
}

export const PathBuilder = ({ srcId, dstId, viaIds, onReset, onCancel, selectedSliceId }: PathBuilderProps) => {
  const devices = useNetworkStore(s => s.devices)
  const links = useNetworkStore(s => s.links)
  const { addFlow } = useFlowStore()
  const { slices, assignFlowToSlice } = useSliceStore()
  const [isDeploying, setIsDeploying] = useState(false)
  const [deploymentError, setDeploymentError] = useState<string | null>(null)
  const [deployedRuleCount, setDeployedRuleCount] = useState<number | null>(null)
  const [priorityInput, setPriorityInput] = useState('50000')

  const src = devices.find(d => d.id === srcId)
  const dst = devices.find(d => d.id === dstId)
  const slice = slices.find(s => s.id === selectedSliceId)

  useEffect(() => {
    setPriorityInput(String(Math.max(slice?.priority ?? 50000, 50000)))
  }, [selectedSliceId, slice?.priority])

  const requestedPriority = Number(priorityInput)
  const isPriorityValid = Number.isInteger(requestedPriority) &&
    requestedPriority > 40000 && requestedPriority <= 65535

  // Find a path between src and dst through all devices (BFS)
  const findPath = (srcId: string, dstId: string): string[] => {
    if (!srcId || !dstId) return []
    const adj: Record<string, string[]> = {}
    links.filter(l => {
      const source = devices.find(device => device.id === l.sourceDeviceId)
      const target = devices.find(device => device.id === l.targetDeviceId)
      return l.isUp && source?.type !== 'controller' && target?.type !== 'controller'
    }).forEach(l => {
      if (!adj[l.sourceDeviceId]) adj[l.sourceDeviceId] = []
      if (!adj[l.targetDeviceId]) adj[l.targetDeviceId] = []
      adj[l.sourceDeviceId].push(l.targetDeviceId)
      adj[l.targetDeviceId].push(l.sourceDeviceId)
    })
    const queue = [[srcId]]
    const visited = new Set([srcId])
    while (queue.length) {
      const path = queue.shift()!
      const node = path[path.length - 1]
      if (node === dstId) return path
      for (const next of (adj[node] ?? [])) {
        if (!visited.has(next)) {
          visited.add(next)
          queue.push([...path, next])
        }
      }
    }
    return []
  }

  const buildConstrainedPath = (stops: string[]): string[] => {
    const constrainedPath: string[] = []

    for (let index = 0; index < stops.length - 1; index += 1) {
      const segment = findPath(stops[index], stops[index + 1])
      if (segment.length < 2) return []
      constrainedPath.push(...(index === 0 ? segment : segment.slice(1)))
    }

    // Repeated nodes would create a forwarding loop. Reject that selection
    // instead of installing ambiguous rules on the same switch.
    return new Set(constrainedPath).size === constrainedPath.length
      ? constrainedPath
      : []
  }

  const path = srcId && dstId
    ? buildConstrainedPath([srcId, ...viaIds, dstId])
    : []

  const switchesOnPath = path.filter(id => devices.find(d => d.id === id)?.type === 'switch')

  const getOutputPort = (route: string[], switchIndex: number): number => {
    const switchId = route[switchIndex]
    const nextHopId = route[switchIndex + 1]
    const link = links.find(item => item.isUp && (
      (item.sourceDeviceId === switchId && item.targetDeviceId === nextHopId) ||
      (item.targetDeviceId === switchId && item.sourceDeviceId === nextHopId)
    ))

    if (!link) throw new Error(`No active link from ${switchId} to ${nextHopId}`)
    const port = link.sourceDeviceId === switchId ? link.sourcePort : link.targetPort
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`Invalid output port from ${switchId} to ${nextHopId}`)
    }
    return port
  }

  const deployFlow = async () => {
    if (!srcId || !dstId || path.length < 2 || isDeploying) return
    if (!isPriorityValid) {
      setDeploymentError('Priority must be an integer between 40001 and 65535.')
      return
    }
    if (src?.type !== 'host' || dst?.type !== 'host') {
      setDeploymentError('Source and destination must both be hosts.')
      return
    }
    if (!src.ipAddress || !dst.ipAddress || !src.macAddress || !dst.macAddress) {
      setDeploymentError('Both hosts need an IP and MAC address discovered by ONOS.')
      return
    }

    setIsDeploying(true)
    setDeploymentError(null)
    setDeployedRuleCount(null)

    const priority = requestedPriority
    const newFlowIds: string[] = []
    const routes = [
      { route: path, source: src, destination: dst },
      { route: [...path].reverse(), source: dst, destination: src },
    ]

    try {
      for (const { route, source, destination } of routes) {
        for (let index = 0; index < route.length - 1; index += 1) {
          const switchId = route[index]
          if (devices.find(device => device.id === switchId)?.type !== 'switch') continue

          const outPort = getOutputPort(route, index)
          const matches = [
            {
              ethType: '0x0800',
              ethSrc: source.macAddress,
              ethDst: destination.macAddress,
              ipSrc: `${source.ipAddress}/32`,
              ipDst: `${destination.ipAddress}/32`,
            },
            {
              ethType: '0x0806',
              ethSrc: source.macAddress,
            },
          ]

          for (const match of matches) {
            const actions = [{ type: 'OUTPUT' as const, port: outPort }]
            const result = await pushFlowToOnos(
              switchId,
              priority,
              match,
              actions,
              true,
              0,
              'org.onosproject.rest',
            )
            const flow: FlowRule = {
              id: result.flowId,
              deviceId: result.deviceId,
              tableId: 0,
              priority,
              timeout: 0,
              hardTimeout: 0,
              isPermanent: true,
              state: 'PENDING_ADD',
              bytes: 0,
              packets: 0,
              createdAt: new Date().toISOString(),
              appId: 'org.onosproject.rest',
              match,
              actions,
            }
            addFlow(flow)
            newFlowIds.push(flow.id)
          }
        }
      }

      if (selectedSliceId) {
        newFlowIds.forEach(id => assignFlowToSlice(id, selectedSliceId))
      }
      setDeployedRuleCount(newFlowIds.length)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown ONOS error'
      setDeploymentError(
        `${message}. ${newFlowIds.length} rule${newFlowIds.length === 1 ? '' : 's'} installed before the failure.`,
      )
    } finally {
      setIsDeploying(false)
    }
  }

  const NodeChip = ({ id, step }: { id: string | null; step: string }) => {
    const device = id ? devices.find(d => d.id === id) : null
    return (
      <div className={clsx(
        'flex items-center gap-2 px-3 py-2 rounded-lg border min-w-32',
        device
          ? 'border-sdn-500/50 bg-sdn-500/10'
          : 'border-dashed border-slate-600 bg-slate-800/50',
      )}>
        {device ? (
          <>
            <span className={clsx(
              'w-2 h-2 rounded-full flex-shrink-0',
              device.type === 'host' ? 'bg-green-400' : 'bg-sky-400',
            )} />
            <div>
              <p className="text-xs font-medium text-slate-100">{device.label}</p>
              <p className="text-[10px] text-slate-500 font-mono">{device.ipAddress}</p>
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-500 italic">{step}</p>
        )}
      </div>
    )
  }

  return (
    <div className="glass-card p-4 space-y-3 border border-sdn-500/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-sdn-400" />
          <span className="text-sm font-semibold text-slate-100">Path Builder</span>
          {slice && (
            <span className={clsx(
              'badge text-xs',
              colorClasses[slice.color as SliceColor]?.bg,
              colorClasses[slice.color as SliceColor]?.text,
            )}>
              {slice.name}
            </span>
          )}
        </div>
        <button onClick={onCancel} className="p-1 rounded hover:bg-slate-700/50">
          <X className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      <p className="text-xs text-slate-400">
        {!srcId
          ? '① Click a host as source'
          : !dstId
          ? '② Optionally click switches as waypoints, then click the destination host'
          : path.length > 1
          ? `Path found: ${path.length - 1} hops · ${switchesOnPath.length} switch${switchesOnPath.length !== 1 ? 'es' : ''}`
          : 'No loop-free active path satisfies the selected waypoints'}
      </p>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <NodeChip id={srcId} step="Select source…" />
        {viaIds.map(id => (
          <div key={id} className="flex items-center gap-2 flex-shrink-0">
            <ArrowRight className="w-4 h-4 text-slate-500" />
            <NodeChip id={id} step="Via switch…" />
          </div>
        ))}
        <ArrowRight className="w-4 h-4 text-slate-500 flex-shrink-0" />
        <NodeChip id={dstId} step="Select dest…" />
      </div>

      {path.length > 1 && (
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {path.map((id, i) => {
            const d = devices.find(dev => dev.id === id)
            return (
              <div key={id} className="flex items-center gap-1 flex-shrink-0">
                <span className={clsx(
                  'text-xs px-2 py-0.5 rounded font-mono',
                  d?.type === 'switch'
                    ? 'bg-sky-500/20 text-sky-300'
                    : 'bg-green-500/20 text-green-300',
                )}>
                  {d?.label ?? id.slice(0, 6)}
                </span>
                {i < path.length - 1 && <span className="text-slate-600 text-xs">→</span>}
              </div>
            )
          })}
        </div>
      )}

      {deploymentError && (
        <div className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{deploymentError}</span>
        </div>
      )}
      {deployedRuleCount !== null && (
        <div className="flex items-center gap-2 rounded border border-green-500/30 bg-green-500/10 p-2 text-xs text-green-300">
          <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
          Installed {deployedRuleCount} IPv4/ARP rules in both directions.
        </div>
      )}

      <div>
        <label htmlFor="path-priority" className="mb-1 block text-xs font-medium text-slate-400">
          Flow priority
        </label>
        <input
          id="path-priority"
          type="number"
          min={40001}
          max={65535}
          step={1}
          value={priorityInput}
          onChange={(event) => {
            setPriorityInput(event.target.value)
            setDeploymentError(null)
            setDeployedRuleCount(null)
          }}
          disabled={isDeploying}
          className={clsx(
            'w-full rounded-lg border bg-slate-800 px-3 py-2 font-mono text-sm text-slate-100 outline-none',
            isPriorityValid
              ? 'border-slate-700 focus:border-sdn-500'
              : 'border-red-500/50 focus:border-red-400',
          )}
        />
        <p className="mt-1 text-[10px] text-slate-500">
          Use a higher value to replace an older path for the same host pair.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => {
            setDeploymentError(null)
            setDeployedRuleCount(null)
            onReset()
          }}
          disabled={isDeploying}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-300 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Reset
        </button>
        <button
          onClick={deployFlow}
          disabled={!srcId || !dstId || path.length < 2 || !isPriorityValid || isDeploying}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded bg-sdn-600 hover:bg-sdn-500 text-sm text-white disabled:opacity-40 transition-colors"
        >
          {isDeploying
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Zap className="h-3.5 w-3.5" />}
          {isDeploying
            ? 'Installing…'
            : `Deploy ${switchesOnPath.length * 4} Flow Rules`}
        </button>
      </div>
    </div>
  )
}
