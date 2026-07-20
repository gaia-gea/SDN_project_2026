# SDN Dashboard Implementation Log

This document records the relevant implementation changes made to the SDN Dashboard. It is intended to support the final report, technical presentation, and live demonstration. It should be updated whenever the project behavior, architecture, configuration, or user interface changes.

## 1. Environment and real-mode execution

### Objective

Run the dashboard against the physical ONOS/OVS testbed while retaining the simulated demo mode for development.

### Files involved

- `sdn-dashboard/.env.local`
- `sdn-dashboard/.env.example`
- `sdn-dashboard/.gitignore`
- `sdn-dashboard/src/App.tsx`
- `sdn-dashboard/vite.config.ts`

### Implementation

Vite uses `.env.local` as the machine-specific runtime configuration. `.env.example` remains a template and is not loaded automatically. Browser-visible variables use the `VITE_` prefix, including:

```env
VITE_ONOS_HOST=<controller-address>
VITE_ONOS_PORT=8181
VITE_ONOS_USER=onos
VITE_ONOS_PASSWORD=rocks
VITE_DEMO_MODE=false
```

`.env.local` was added to `.gitignore` so controller addresses and credentials are not committed as shared source configuration.

`App.tsx` now separates the two operating modes:

- Demo mode starts the mock simulation and stops it during component cleanup.
- Real mode mounts `RealModePolling`, which invokes the ONOS polling hooks.
- Mock data is not started while connected to real hardware.

### Why it matters

This prevents mock topology and traffic values from overwriting real ONOS data. It also ensures that polling is enabled only when `VITE_DEMO_MODE=false`.

### Verification

1. Set `VITE_DEMO_MODE=false` in `.env.local`.
2. Restart the Vite development server.
3. Confirm that devices, hosts, links, flows, and statistics correspond to the physical testbed.

---

## 2. Real topology host naming

### Objective

Make ONOS-discovered hosts easier to identify in the dashboard.

### File involved

- `sdn-dashboard/src/services/onosApi.ts`

### Previous behavior

Hosts were primarily labeled using part of the ONOS host ID/MAC address. This made it difficult to distinguish physical hosts during experiments.

### Implementation

`transformOnosHost()` retains the stable ONOS host ID internally and stores the discovered IP address, MAC address, VLAN, and configured status. During topology construction, hosts are sorted numerically by IPv4 address and assigned deterministic labels:

```text
Host 1
Host 2
Host 3
```

The IP address remains available separately in the device object and user interface.

### Why it matters

The ONOS ID remains the stable key used by stores and topology links, while the visible label becomes suitable for demonstrations and reports. Sorting by IP prevents host numbering from changing merely because the REST API returns hosts in a different order.

---

## 3. Visual control-plane links between ONOS and switches

### Objective

Display the relationship between the ONOS controller and every discovered switch in the topology graph.

### File involved

- `sdn-dashboard/src/services/onosApi.ts`

### Background

The ONOS `/onos/v1/links` endpoint represents data-plane links between network devices. It does not normally return controller-to-switch OpenFlow sessions as topology links. The dashboard already created a synthetic `ctrl-1` controller node, but no edges connected that node to the switches.

### Implementation

After transforming and deduplicating the real ONOS links, the dashboard creates one synthetic control-plane link per discovered switch:

```text
ctrl-1 -> switch device ID
```

The synthetic links use:

- Controller ID as the source.
- ONOS switch device ID as the target.
- Switch availability to determine `isUp`.
- Zero-valued metrics because the control-plane link is not measured by the existing port-statistics pipeline.

### Important interpretation

These edges are visual representations of controller ownership/connectivity. They are not physical data-plane links and are not returned by the ONOS links REST endpoint. Their zero latency, throughput, utilization, and loss values mean “not measured,” not necessarily a measured value of zero.

---

## 4. Traffic Generator integration in the Experiments page

### Objective

Present the real-hardware Traffic Generator as a selectable extension instead of permanently displaying it above every experiment.

### File involved

- `sdn-dashboard/src/pages/ExperimentsPage.tsx`

### Previous behavior

`TrafficGeneratorPanel` was rendered unconditionally in the right-hand detail pane. Consequently, it remained visible even when the user selected a different experiment.

### Implementation

A dedicated `Traffic Generator` card was added to the left-hand list. It is identified by the selection value:

```text
traffic-generator
```

The right-hand panel now uses conditional rendering:

- If `selectedId === 'traffic-generator'`, render `TrafficGeneratorPanel`.
- If a normal experiment is selected, render its description, traffic profiles, and results.
- If nothing is selected, render the empty-state message.

The card is labeled `Hardware` and uses a radio icon to distinguish it from the simulated experiment entries.

### Why it matters

The Traffic Generator now follows the same master-detail interaction pattern as the other experiment options. Its functional state remains in `trafficStore`, so selecting another view does not redefine how jobs are executed or communicated to the host agents.

### Hardware role

The panel initiates real ICMP or `iperf3` traffic through the HTTP agent running on a selected host. This implements Extension B1 and provides traffic that can be affected by the flow-rule functionality in Extension C.

---

## 5. Delete flow rules from the dashboard (Extension C1)

### Objective

Allow users to remove a flow rule from ONOS directly through the Flow Rules table.

### Files involved

- `sdn-dashboard/src/pages/FlowsPage.tsx`
- `sdn-dashboard/src/services/onosApi.ts` (existing `deleteFlow` service)
- `sdn-dashboard/src/stores/flowStore.ts` (existing `removeFlow` action)

### Data flow

The deletion operation has two distinct stages:

```text
Delete button
    -> confirmation dialog
    -> ONOS REST DELETE request
    -> remove flow from the local Zustand store
```

`handleDelete(flow)` calls:

```typescript
await deleteFlow(flow.deviceId, flow.id)
removeFlow(flow.id)
```

The REST request targets:

```text
DELETE /onos/v1/flows/{deviceId}/{flowId}
```

The local row is removed only after ONOS responds successfully. If the request fails, the error is logged and the user receives an alert; the row remains visible rather than falsely implying that the hardware rule was removed.

### User-interface changes

- Added an `Actions` column.
- Added a trash icon to each flow row.
- Stopped the button click from propagating to the row-selection handler.
- Added a confirmation dialog before performing the destructive action.
- Updated the empty-table `colSpan` to match the new column count.

### Safety consideration

The table includes rules installed by multiple ONOS applications, not only rules created by the dashboard. For demonstrations, the user should delete a known test rule, preferably one owned by `org.onosproject.rest`. Removing forwarding or discovery rules belonging to ONOS applications may disrupt normal connectivity.

### Verification

Before deleting a rule:

```bash
curl -u onos:rocks http://<ONOS_IP>:8181/onos/v1/flows
sudo ovs-ofctl -O OpenFlow13 dump-flows br0
```

After using the trash button, repeat both commands. The selected rule should disappear from the dashboard, ONOS REST response, and OVS flow table.

---

## 6. Flow table switch name and device ID columns

### Objective

Make it immediately clear which physical/logical switch contains each flow rule while retaining the exact ONOS device identifier needed for REST and command-line verification.

### File involved

- `sdn-dashboard/src/pages/FlowsPage.tsx`

### Previous behavior

The `Device` column displayed either the device label or a shortened portion of the device ID. It did not clearly show both values at the same time.

### Implementation

The original column was divided into:

- `Switch`: displays the human-readable device label from `networkStore`.
- `Device ID`: displays the ONOS identifier, for example `of:0000000000000001`.

The device ID cell uses a maximum width and visual truncation to protect the table layout. The full value is retained in the HTML `title` attribute and appears when the pointer hovers over the cell.

The empty-table `colSpan` was updated to nine columns:

1. Slice color indicator.
2. Switch.
3. Device ID.
4. Priority.
5. Match.
6. Action.
7. State.
8. Bytes.
9. Actions.

### Why it matters

The readable switch label supports classroom explanation, while the exact ONOS ID can be matched against:

```bash
curl -u onos:rocks http://<ONOS_IP>:8181/onos/v1/devices
```

and the corresponding switch flow-table evidence.

---

## 7. Relationship between Extensions B and C

The Traffic Generator and flow-rule controls form a useful end-to-end SDN demonstration:

1. Extension B generates identifiable traffic between two physical hosts.
2. The traffic uses a selected protocol, destination address, and optionally a transport-layer port.
3. Extension C installs or removes rules that match that traffic on a selected switch.
4. The operator repeats the same traffic test.
5. Reachability or measured performance changes as a result of the data-plane rule.
6. ONOS REST output and `ovs-ofctl dump-flows` provide evidence that the dashboard action reached the physical network.

This demonstrates the closed SDN control loop: observe the topology, define policy at the controller, apply it to the data plane, generate real traffic, and measure the result.

---

## 8. Validation performed

The modified TypeScript source has been checked with:

```bash
cd sdn-dashboard
npm run type-check
```

Production builds have also been tested with:

```bash
npm run build
```

The repository currently defines an ESLint script but does not include an ESLint configuration file, so linting cannot run until that configuration is added.

## 9. Flow-table filtering from topology selection

### Objective

Reduce ambiguity on the Flow Rules page by allowing the topology graph to act as a visual switch filter for the flow table.

### File involved

- `sdn-dashboard/src/pages/FlowsPage.tsx`

### Previous behavior

The topology and flow table were displayed on the same page, but selecting a
switch in the graph did not affect the table. The user had to identify the
switch manually from the device column or type its name/ONOS ID into the text
search field. This became difficult when ONOS returned many rules for several
switches at the same time.

Topology selection was already used for visual interaction and by PathBuilder,
so the new behavior had to preserve route-endpoint selection while adding a
separate table-filtering interaction.

### State added

The page now stores the active topology filter independently from the selected
flow-table row:

```ts
const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
```

This separation is important because `selectedFlowId` represents one specific
rule, whereas `selectedDeviceId` represents the switch whose complete set of
rules must be displayed. A `null` value means that no switch filter is active.

### Connecting topology selection to the page

`NetworkTopologyGraph` already exposes an `onSelect` callback. `FlowsPage`
connects it to a new memoized handler:

```tsx
<NetworkTopologyGraph
  onSelect={handleTopologySelect}
  highlightDeviceIds={highlightDeviceIds}
  pathBuilderMode={pathBuilderMode}
  onPathNodeClick={handlePathNodeClick}
/>
```

The handler receives a `SelectedElement`, checks the kind of selected topology
element, and resolves the corresponding entry in `networkStore`:

```ts
const handleTopologySelect = useCallback((element: SelectedElement) => {
  if (pathBuilderMode) return

  if (element.type === null) {
    setSelectedDeviceId(null)
    return
  }

  if (element.type !== 'device' || !element.id) return
  const device = devices.find(item => item.id === element.id)
  if (device?.type === 'switch') {
    setSelectedDeviceId(device.id)
    setSelectedFlow(null)
  }
}, [devices, pathBuilderMode, setSelectedFlow])
```

The checks provide the following behavior:

- A switch node activates the filter using its full, exact ONOS device ID.
- Selecting a host or controller does not change the flow filter, because flow
  rules in this table belong to OpenFlow switches.
- Selecting the graph background produces an element with `type === null` and
  clears the filter.
- PathBuilder mode returns before changing the filter, leaving topology clicks
  available for source and destination selection.
- Activating a switch filter clears `selectedFlowId`, preventing a previously
  selected rule from remaining highlighted after it disappears from the table.

### Filtering implementation

Filtering is performed with exact `deviceId` equality rather than a label or
partial-text comparison:

```ts
const filteredByDevice = selectedDeviceId
  ? filteredBySlice.filter(flow => flow.deviceId === selectedDeviceId)
  : filteredBySlice
```

This uses the same identifier provided by ONOS in both the topology device and
the flow rule. Human-readable labels are not used as keys because they can be
renamed or duplicated.

The text search was updated to consume `filteredByDevice` instead of
`filteredBySlice`. Consequently, filters are composed rather than replacing one
another:

```text
all flows -> selected slice -> selected switch -> text search
```

For example, selecting a slice, clicking Switch 2, and searching for an IP
address shows only rules that satisfy all three conditions.

### Visual feedback and filter removal

When a switch is selected, its ID is added to `highlightDeviceIds`. The graph
therefore highlights the same switch whose rules are visible in the table. This
highlight has priority over flow-row and slice highlighting while the device
filter is active.

The page also resolves the switch object to show its human-readable label in a
filter badge beside the search field. If the label cannot be resolved, the full
device ID is used as a fallback. The badge contains a close button with the
accessible label `Clear switch filter`; pressing it sets
`selectedDeviceId` to `null` and restores the unfiltered device set.

The flow counter now reflects the result and, when appropriate, displays the
filtered count relative to the slice-level total. This gives immediate feedback
that only part of the available rule collection is visible.

### Complete interaction flow

When the user clicks a switch node:

1. The selected switch ID is stored in `selectedDeviceId`.
2. Any selected flow row is cleared.
3. The flow collection is filtered by exact `deviceId` equality.
4. The selected switch is highlighted in the topology.
5. A removable filter badge showing the switch label appears beside the search field.

Clicking the graph background or the badge's close button clears the device
filter and restores flows from all switches, while preserving any active slice
or text-search filters.

### Validation

The change was checked with:

```bash
cd sdn-dashboard
npm run type-check
npm run build
```

Both commands completed successfully. The expected manual UI checks are:

1. Open the Flow Rules page with rules from at least two switches.
2. Click one switch and confirm every visible row has that switch's exact
   `deviceId`.
3. Confirm the switch is highlighted and its filter badge is visible.
4. Select a slice or enter a search term and confirm the filters combine.
5. Click a host or controller and confirm it does not replace the switch filter.
6. Enable PathBuilder and confirm topology clicks choose endpoints instead of
   changing the flow-table filter.
7. Click the graph background or the badge close button and confirm flows from
   all switches return.

### Design limitations

- The filter is local UI state and is not persisted after leaving or reloading
  the page.
- It filters the flow rules already loaded into the Zustand store; it does not
  issue a new per-device ONOS REST request.
- If the selected switch disappears during topology polling, its ID remains the
  active filter until the user clears it, and the table may temporarily be
  empty.

### Why it matters

ONOS flow IDs and OpenFlow device IDs are difficult to compare visually in a large table. Selecting the switch directly from the network diagram makes it clear which rules are installed on that device and supports a more understandable B+C hardware demonstration.

---

## 10. PathBuilder flow deployment

### Objective

Turn PathBuilder from a topology-only path selector into a control-plane action
that installs the rules required for bidirectional host communication through
the selected route.

### File involved

- `sdn-dashboard/src/components/flows/PathBuilder.tsx`

### Previous behavior and routing issue

PathBuilder could select endpoints and calculate a path, but deployment did not
provide useful progress or error feedback. In addition, the topology contains
synthetic controller-to-switch links for visualization. The BFS calculation
treated those links as data-plane links and could select a route through the
ONOS controller, producing an invalid OpenFlow output port `0`.

### Path calculation

The adjacency graph now includes only active links whose endpoints are not
controller nodes. Consequently, the computed route contains hosts and switches
connected through real data-plane or host-access links. Before submitting each
rule, PathBuilder resolves the link to the next hop and verifies that its output
port is a positive number.

Both selected endpoints must be hosts discovered by ONOS and must have IP and
MAC addresses. Missing information is reported in the PathBuilder panel instead
of attempting to submit incomplete rules.

### Rules installed

PathBuilder traverses the selected path in both directions. For every switch it
installs:

1. An IPv4 rule matching the source/destination IP and MAC addresses and
   outputting toward the next hop.
2. An ARP rule matching frames originated by the source host and outputting
   toward the next hop.

The same pair is generated for the reverse route. Therefore the total is four
rules per switch on the path. ARP rules are necessary when the forwarding
application is disabled and the hosts do not already have each other's MAC
address cached. IPv4 rules then carry ping and other IP traffic in both
directions.

Rules are submitted through `onosApi.addFlow()` as permanent flows owned by
`org.onosproject.rest`. The selected slice priority is used when a slice is
active; otherwise the priority is `50000`. The default is deliberately higher
than the general priority-`40000` ARP rule that sends packets to the controller;
an active slice must likewise use a priority above `40000` for this experiment.
If both rules have the same priority, OpenFlow does not guarantee that the more
specific PathBuilder rule wins, and ARP can be consumed by the controller
instead of traversing the selected path. Successfully returned rules are added
to `flowStore` and associated with the active slice.

### User feedback

The Deploy button now:

- Shows the number of rules that will be created.
- Is disabled while a deployment is running.
- Displays an animated installation state.
- Shows a success message with the installed rule count.
- Displays ONOS or topology errors in the panel, including how many rules were
  installed before a partial failure.

Reset clears both endpoints and the deployment message. The chosen endpoints
remain visible after a successful installation so the operator can verify the
route and result before resetting the builder.

### Verification

1. Disable the reactive forwarding application if the experiment requires a
   fully dashboard-managed route.
2. Select two hosts in PathBuilder and verify that the displayed route never
   includes the ONOS controller.
3. Press Deploy and confirm the success count equals four times the number of
   switches shown on the route.
4. Filter the flow table by each switch and verify the forward/reverse IPv4 and
   ARP rules and their output ports.
5. Run a ping between the selected hosts and confirm that traffic crosses the
   installed route.
6. Check ONOS and OVS directly with the REST flow endpoint and
   `ovs-ofctl -O OpenFlow13 dump-flows <bridge>`.

### Limitation

Rules are submitted sequentially. If ONOS rejects a later rule, rules already
accepted remain installed and the panel reports the partial count so they can
be identified and removed. Deployment is not an atomic transaction across all
switches.

---

## 11. UDP meter rules from the Flow Rule Editor

### Objective

Support the bandwidth-limiting experiment in Extension B, Test 2 entirely from
the dashboard. An operator can create a meter and install a port-specific UDP
flow that applies the meter before forwarding traffic.

### Files involved

- `sdn-dashboard/src/types/index.ts`
- `sdn-dashboard/src/services/onosApi.ts`
- `sdn-dashboard/src/components/flows/FlowRuleEditor.tsx`

### Previous behavior

The shared flow types already contained `ipProto`, `udpSrc`, `udpDst`, and the
`METER` action, but the feature was incomplete end to end:

- The Flow Rule Editor did not expose IP protocol or UDP destination port.
- `buildOnosFlowBody()` did not serialize those match fields.
- The editor did not offer a METER action.
- No dashboard service could create a meter or recover the ID allocated by
  ONOS.
- Flow parsing did not retain IP protocol and METER instructions returned by
  ONOS.

Consequently, a student could generate UDP traffic on port 5201 but could not
create the 50 Mbps policy described by Test 2 from the dashboard.

### Meter creation and ID recovery

`onosApi.ts` now exposes `getMetersForDevice()` and `addMeter()`. The latter
validates the requested Mbps value and submits a `DROP` band to:

```text
POST /onos/v1/meters/{deviceId}
```

The request uses `KB_PER_SEC`, with the UI value converted from Mbps to
kilobits per second. For example, 50 Mbps becomes a band rate of `50000`.

ONOS versions differ in how they report a newly allocated meter ID. The client
therefore accepts it from, in order:

1. A `meterId` or `id` field in the response body.
2. The numeric suffix of the HTTP `Location` header.
3. A short read-back loop that compares the device's meter collection with the
   IDs present before creation.

If none of these mechanisms exposes the ID, the editor reports an explicit
error instead of installing a flow with an undefined meter reference.

### Flow editor behavior

The editor now provides:

- `IP Protocol`, where UDP is protocol `17`.
- `UDP Dst Port`, used as `UDP_DST` in the ONOS selector.
- `METER (rate limit)` as an action with a rate in Mbps.

When the form is submitted, each new METER action is resolved first. The
dashboard creates the meter on the selected switch, receives its ID, replaces
the temporary rate value with that `meterId`, and then submits the flow. The
flow should also retain an OUTPUT action so accepted traffic continues toward
the next hop.

`buildOnosFlowBody()` now emits `IP_PROTO`, `UDP_SRC`, `UDP_DST`, and `METER`
objects. The inverse parsers retain the same criteria and meter ID when flows
are refreshed from ONOS.

### Test 2 configuration

For a 200 Mbps UDP CBR test from H1 to H2 on destination port 5201:

1. Use the switch directly connected to H1.
2. Set the metered flow priority above the PathBuilder priority, for example
   `55000`.
3. Match Ethernet type `0x0800`, IP protocol `17`, and UDP destination port
   `5201`.
4. Add a METER action with rate `50` Mbps.
5. Retain an OUTPUT action using the same next-hop port as the existing
   H1-to-H2 PathBuilder rule.

Expected OVS state:

```text
meter=1 kbps bands=type=drop rate=50000
priority=55000,udp,tp_dst=5201 actions=meter:1,output:<next-hop-port>
```

The experiment can be checked with:

```bash
ovs-ofctl -O OpenFlow13 dump-meters <bridge>
ovs-ofctl -O OpenFlow13 dump-flows <bridge> | grep 55000
iperf3 -c 10.0.0.2 -u -p 5201 -b 200M -t 10
```

The expected received throughput is approximately 50 Mbps, subject to meter
implementation, sampling interval, and normal UDP loss.

### Validation and limitations

The implementation was checked with:

```bash
cd sdn-dashboard
npm run type-check
npm run build
```

Both commands completed successfully. Hardware/Mininet verification remains
necessary because the controller was not reachable from the development
environment during implementation. Meter creation is intentionally performed
before flow creation; if the subsequent flow request fails, the created meter
remains on the switch and must be removed separately.

### Why it matters

This completes a policy-to-data-plane loop: the dashboard defines a bandwidth
policy, ONOS allocates a meter, the flow selector identifies UDP traffic by L4
port, and OVS enforces the rate before forwarding. The iperf3 result then
provides observable evidence that the SDN policy changed real traffic behavior.

---

## 12. PathBuilder waypoint routing

### Objective

Extend PathBuilder beyond automatic shortest-path routing so Extension B, Test
3 can steer traffic through a user-selected sequence of intermediate switches.

### Files involved

- `sdn-dashboard/src/pages/FlowsPage.tsx`
- `sdn-dashboard/src/components/flows/PathBuilder.tsx`

### Selection and routing behavior

Path-building clicks now have an explicit order:

1. Click a host to select the source.
2. Optionally click one or more switches to add ordered waypoints. Clicking an
   already selected waypoint removes it.
3. Click a different host to select the destination.

`FlowsPage` stores the waypoint IDs separately from the endpoints and includes
all selected nodes in topology highlighting. Reset, cancel, and mode toggling
clear the complete selection.

PathBuilder calculates a shortest active segment between each consecutive pair
in `[source, ...waypoints, destination]` and concatenates the segments. The
controller remains excluded from the data-plane adjacency graph. A constrained
route containing a repeated node is rejected because installing different
output decisions for the same host pair on the same switch would create an
ambiguous forwarding loop.

The final constrained route is displayed in the panel and is reversed exactly
for return traffic. IPv4 and ARP rules are therefore installed in both
directions through the same selected switches. PathBuilder exposes a numeric
flow-priority field initialized from the active slice or `50000`. The accepted
range is `40001` through `65535`, ensuring its ARP rules take precedence over
the general priority-`40000` controller rule. A newer route for the same host
pair can use a higher priority than the old route; OpenFlow then selects the
new route at their shared ingress switch without relying on equal-priority
overlap behavior.

### Test 3 usage

For a topology where the default H1-to-H3 route uses S1-to-S2, an alternative
route can be selected as:

```text
H1 -> S3 waypoint -> H3
```

The segment calculation expands this into the actual connected route, for
example:

```text
H1 -> S1 -> S3 -> S2 -> H3
```

After deployment, `iperf3` TCP Bulk traffic can be compared before and after
the steering rule using OVS flow counters on the original and alternative
transit links.

### Validation

The extension passed `npm run type-check`, `npm run build`, and
`git diff --check`. Real path-steering verification still requires deploying
the rules to ONOS and comparing OVS counters during a TCP Bulk run.

---

## 13. Live traffic path in Experiments

### Objective

Show the data-plane path below Traffic Generator while ping, TCP, or UDP tests
are running, and make the time progress bar advance independently of agent
polling latency.

### Files involved

- `sdn-dashboard/src/components/experiments/TrafficGeneratorPanel.tsx`
- `sdn-dashboard/src/components/topology/NetworkTopologyGraph.tsx`
- `sdn-dashboard/src/hooks/useOnosPolling.ts`

### Implementation

The Experiments panel reuses `NetworkTopologyGraph`. During an active job it
traces the highest-priority matching IPv4 rules and follows their OUTPUT ports
from source to destination. If the rule set is not yet available, it falls
back to the shortest active topology path. A 450 ms animation then illuminates
one link at a time from source to destination and back to the source. This
represents ping request/reply movement and TCP data/acknowledgement directions;
unrelated nodes and links are dimmed at each instant.

Port polling now calculates instantaneous throughput from byte-counter deltas
and elapsed poll time, then updates each `networkStore` link's throughput and
utilization. The link currently occupied by the animation is widened and keeps
its own utilization color (green, amber, or red); the rest of the route is not
simultaneously illuminated. This allows a metered path to show different load
before and after the meter rather than assigning one misleading color to the
entire route.

The progress bar uses a 250 ms local timer derived from the active job's
`startedAt` timestamp and reconciles it with `elapsed_sec` returned by the
agent. It therefore advances smoothly even though `/result` is polled every
two seconds.

### Validation

The changes passed `npm run type-check`, `npm run build`, and
`git diff --check`. Real-mode validation should run ping, UDP CBR with and
without a meter, and TCP Bulk across two alternative PathBuilder routes.

---

## 14. Future updates

For each subsequent change, add a new numbered section containing:

- Objective and motivation.
- Files changed.
- Previous behavior.
- Implementation and data flow.
- Important design decisions or limitations.
- Hardware verification procedure.
- Connection to the SDN concept demonstrated.
