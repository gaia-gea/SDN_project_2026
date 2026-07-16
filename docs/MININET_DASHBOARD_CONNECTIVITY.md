# Conectividad entre el dashboard y los agentes de Mininet

## Problema

Los agentes pueden funcionar correctamente dentro de los hosts de Mininet y, aun así, ser inaccesibles desde el dashboard.

Por ejemplo, estas pruebas pueden funcionar:

```bash
mininet> h1 curl http://127.0.0.1:5000/health
mininet> h2 curl http://10.0.0.1:5000/health
```

Pero los botones **Test agent**, **Start** y **Ping** del dashboard pueden fallar.

La causa más probable es que el navegador y Vite se ejecutan en el namespace principal de Linux, mientras que los agentes se encuentran dentro de los namespaces aislados de Mininet.

```text
Linux principal
├── navegador
├── Vite
├── ONOS/Docker
└── Mininet
    ├── namespace h1: 10.0.0.1
    ├── namespace h2: 10.0.0.2
    ├── namespace h3: 10.0.0.3
    └── namespace h4: 10.0.0.4
```

Que `h1` pueda contactar con `h2` no significa necesariamente que Linux principal pueda contactar con `h1`.

El dashboard necesita poder hacer esta conexión:

```text
Navegador/Linux principal → http://10.0.0.1:5000
```

---

## 1. Confirmar el problema

Mantener Mininet y los agentes funcionando. Abrir otro terminal Linux normal, fuera de la CLI de Mininet.

Ejecutar:

```bash
curl -v --max-time 5 http://10.0.0.1:5000/health
```

Comprobar también qué ruta intenta utilizar Linux:

```bash
ip route get 10.0.0.1
```

### Resultado que confirma un problema de ruta

Si `curl` muestra alguno de estos errores:

```text
Connection timed out
No route to host
Failed to connect
```

la situación es:

```text
Los hosts de Mininet pueden acceder a los agentes.
Linux principal no puede acceder a los agentes.
El navegador tampoco puede acceder a los agentes.
```

En ese caso, el problema no está en React, Zustand ni `agent.py`. Falta conectar el namespace principal de Linux con la red de datos de Mininet.

### Si curl funciona desde Linux principal

Si este comando responde correctamente:

```bash
curl http://10.0.0.1:5000/health
```

entonces la ruta existe. El siguiente paso es revisar la petición del navegador:

```text
F12 → Network → pulsar Test agent → seleccionar /health
```

Significado de los errores más comunes:

| Error | Significado |
|-------|-------------|
| `ERR_CONNECTION_TIMED_OUT` | No existe una ruta correcta hasta Mininet |
| `ERR_CONNECTION_REFUSED` | El agente no está escuchando en esa IP o puerto |
| `CORS policy` | Flask no está autorizando peticiones desde el navegador |
| `Mixed Content` | Un dashboard HTTPS está intentando llamar a un agente HTTP |
| HTTP `500` | El agente recibió la petición, pero ocurrió un error interno |

El agente debe incluir soporte CORS:

```python
from flask_cors import CORS

app = Flask(__name__)
CORS(app)
```

---

## 2. Comprobaciones dentro de Mininet

Antes de cambiar la red, verificar de nuevo las capas anteriores.

### Agente local

```bash
mininet> h1 curl http://127.0.0.1:5000/health
```

### Agente remoto dentro de Mininet

```bash
mininet> h2 curl http://10.0.0.1:5000/health
```

### Procesos de agentes

```bash
mininet> h1 pgrep -a -f agent.py
mininet> h2 pgrep -a -f agent.py
```

### Puerto del agente

```bash
mininet> h1 ss -ltnp
```

Debe aparecer el puerto 5000 escuchando en `0.0.0.0`:

```text
0.0.0.0:5000
```

Si solo aparece `127.0.0.1:5000`, otros hosts y el dashboard no podrán contactar con el agente.

---

## 3. Solución temporal: interfaz interna de OVS

Esta solución permite comprobar rápidamente si el problema es la falta de conectividad entre Linux principal y Mininet.

Con Mininet iniciado, abrir otro terminal Linux y añadir una interfaz interna al switch `s1`:

```bash
sudo ovs-vsctl add-port s1 sdn-mgmt \
  -- set Interface sdn-mgmt type=internal
```

Asignar al namespace principal una dirección dentro de la red Mininet:

```bash
sudo ip addr add 10.0.0.254/24 dev sdn-mgmt
sudo ip link set sdn-mgmt up
```

Comprobar la interfaz:

```bash
ip addr show sdn-mgmt
```

Comprobar la ruta:

```bash
ip route get 10.0.0.1
```

El resultado debería indicar algo similar a:

```text
10.0.0.1 dev sdn-mgmt src 10.0.0.254
```

Probar conectividad:

```bash
ping -c 3 10.0.0.1
```

Después probar el agente:

```bash
curl http://10.0.0.1:5000/health
```

Respuesta esperada:

```json
{
  "running": false,
  "status": "ok"
}
```

Si esta petición funciona, abrir el dashboard y pulsar **Test agent**.

Es posible que la primera petición tarde unos segundos mientras ONOS descubre la nueva dirección e instala reglas de forwarding.

### Retirar la interfaz temporal

Después de finalizar las pruebas:

```bash
sudo ip link delete sdn-mgmt
```

Si el puerto continúa registrado en OVS:

```bash
sudo ovs-vsctl --if-exists del-port s1 sdn-mgmt
```

También se puede limpiar Mininet:

```bash
sudo mn -c
```

---

## 4. Solución permanente en CTopo.py

La solución permanente consiste en conectar el namespace principal de Linux al switch `s1` cada vez que se crea la topología.

Archivo:

```text
Task3_Topology_Automation/CTopo.py
```

Dentro de `MountMininet(net)`, añadir un host especial sin namespace propio antes de ejecutar `net.start()`:

```python
# Connect the Linux root namespace to the Mininet data network.
root_host = net.addHost(
    'root-host',
    inNamespace=False,
    ip='10.0.0.254/24'
)

net.addLink(
    root_host,
    net.get('s1')
)
```

La sección completa quedaría conceptualmente así:

```python
net.addController(
    name='c0',
    controller=RemoteController,
    ip=f'{onos_ip}',
    port=6653
)

# Management connection between the Linux host and Mininet.
root_host = net.addHost(
    'root-host',
    inNamespace=False,
    ip='10.0.0.254/24'
)

net.addLink(
    root_host,
    net.get('s1')
)

net.start()
CLI(net)
net.stop()
```

Al estar registrado en `net`, Mininet podrá limpiar el enlace al ejecutar `net.stop()`.

### Comprobar la solución permanente

Después de iniciar la topología:

```bash
ip route get 10.0.0.1
ping -c 3 10.0.0.1
curl http://10.0.0.1:5000/health
```

Si `curl` funciona desde el terminal Linux normal, **Test agent** también debería poder funcionar desde el navegador.

---

## 5. Comprobar el modo del dashboard

Para trabajar con la topología real de Mininet, el archivo `sdn-dashboard/.env.local` debería contener:

```env
VITE_DEMO_MODE=false
VITE_ONOS_HOST=<IP_DE_ONOS>
VITE_ONOS_PORT=8181
```

Después de modificar `.env.local`, reiniciar Vite:

```bash
npm run dev
```

Si `VITE_DEMO_MODE` continúa activo, `mockData.ts` puede introducir dispositivos simulados en `networkStore` mientras también se consulta ONOS.

---

## 6. Orden de diagnóstico recomendado

Realizar siempre las pruebas en este orden:

### Paso 1 — Agente local

```bash
mininet> h1 curl http://127.0.0.1:5000/health
```

Comprueba `agent.py` dentro de `h1`.

### Paso 2 — Comunicación entre namespaces

```bash
mininet> h2 curl http://10.0.0.1:5000/health
```

Comprueba la red Mininet.

### Paso 3 — Linux principal hacia Mininet

Desde un terminal Linux normal:

```bash
curl http://10.0.0.1:5000/health
```

Comprueba la ruta desde el sistema donde se ejecuta el navegador.

### Paso 4 — Dashboard hacia el agente

En Experiments:

```text
Seleccionar h1 → Test agent
```

Comprueba:

```text
React → rpiAgent.ts → GET /health → agent.py
```

### Paso 5 — Ping completo

En Experiments:

```text
Origen: h1
Destino: h2
Tipo: ICMP Ping
Start
```

Comprueba:

```text
React
  → trafficStore
  → rpiAgent.ts
  → POST /start
  → agent.py
  → ping
  → GET /result
  → resultado en React
```

Si falla el paso 3, los pasos 4 y 5 no pueden funcionar.

---

## 7. Checklist final

- [ ] `/health` funciona desde `h1` hacia su propio agente.
- [ ] `/health` funciona desde otro host de Mininet.
- [ ] `/health` funciona desde el namespace principal de Linux.
- [ ] `ip route get 10.0.0.1` utiliza la interfaz conectada a Mininet.
- [ ] El agente escucha en `0.0.0.0:5000`.
- [ ] Flask tiene CORS habilitado.
- [ ] El dashboard está en modo real (`VITE_DEMO_MODE=false`).
- [ ] **Test agent** muestra `Agent reachable`.
- [ ] Ping puede iniciarse desde Experiments.
- [ ] `/result` termina en `completed`.
- [ ] El resultado aparece en el historial del dashboard.

