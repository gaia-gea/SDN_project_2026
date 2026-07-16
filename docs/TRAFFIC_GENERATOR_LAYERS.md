# Traffic Generator — guía de implementación por capas

Esta guía describe cómo preparar y verificar el generador de tráfico del apartado B1 de `STUDENT_EXTENSIONS.md` usando primero una red simulada con Mininet.

El objetivo es construir y probar el sistema progresivamente:

```text
Capa 1 — Conectividad Mininet
    h1 puede comunicarse con h2

Capa 2 — Generación de tráfico
    h1 puede ejecutar ping e iperf3 contra h2

Capa 3 — Agente HTTP
    una petición HTTP hace que h1 ejecute ping o iperf3

Capa 4 — Servicio TypeScript (posterior)
    rpiAgent.ts se comunica con el agente

Capa 5 — Estado Zustand (posterior)
    trafficStore guarda el trabajo y sus resultados

Capa 6 — Interfaz React (posterior)
    ExperimentsPage controla y visualiza el experimento
```

Esta guía deja funcionando hasta la capa 3. Las capas 4–6 se conectarán después, cuando el dashboard pueda alcanzar las direcciones de los agentes.

## 0. Requisitos previos

Ejecutar estos comandos en la máquina Linux donde está instalado Mininet:

```bash
sudo apt update
sudo apt install python3-flask iperf3 curl
```

Comprobar las instalaciones:

```bash
python3 --version
iperf3 --version
curl --version
```

Guardar el agente HTTP en una ruta accesible desde Linux. Por ejemplo:

```text
/home/USUARIO/SDN_project/HostAgent.py
```

Los hosts de Mininet utilizan espacios de red diferentes, pero comparten el sistema de archivos de Linux. Por eso todos pueden ejecutar el mismo archivo `HostAgent.py`.

Antes de iniciar Mininet, comprobar la sintaxis del agente:

```bash
python3 -m py_compile /home/USUARIO/SDN_project/HostAgent.py
```

> Sustituir `/home/USUARIO/SDN_project/HostAgent.py` por la ruta real del archivo.

---

## Capa 1 — Conectividad de Mininet

### Objetivo

Confirmar que los hosts de Mininet existen, tienen direcciones IP y pueden comunicarse.

### 1.1. Iniciar ONOS

Iniciar el controlador ONOS siguiendo la configuración del proyecto.

Si se utiliza Docker Compose:

```bash
cd deploy/onos-controller
docker compose up -d
```

Comprobar que ONOS está ejecutándose:

```bash
docker ps
```

### 1.2. Iniciar la topología

Desde la raíz `SDN_project_2026`:

```bash
sudo python3 Task3_Topology_Automation/CTopo.py
```

El script debe abrir la consola interactiva de Mininet:

```text
mininet>
```

### 1.3. Inspeccionar la red

Dentro de la consola de Mininet:

```bash
mininet> nodes
mininet> net
mininet> dump
```

Comprobar las direcciones de los hosts:

```bash
mininet> h1 ip addr
mininet> h2 ip addr
mininet> h3 ip addr
mininet> h4 ip addr
```

Con la configuración predeterminada de Mininet, normalmente se asignan estas direcciones:

| Host | Dirección esperada |
|------|--------------------|
| `h1` | `10.0.0.1` |
| `h2` | `10.0.0.2` |
| `h3` | `10.0.0.3` |
| `h4` | `10.0.0.4` |

Las direcciones reales mostradas por `ip addr` son las que deben utilizarse en las pruebas.

### 1.4. Probar conectividad

Probar primero una comunicación concreta:

```bash
mininet> h1 ping -c 3 10.0.0.2
```

Después probar todos los hosts:

```bash
mininet> pingall
```

### Criterio de finalización de la capa 1

- [ ] ONOS está iniciado.
- [ ] Los cuatro switches aparecen conectados al controlador.
- [ ] Mininet muestra `h1`, `h2`, `h3` y `h4`.
- [ ] Cada host tiene una dirección IP.
- [ ] `h1` puede hacer ping a `h2`.
- [ ] `pingall` no muestra pérdidas inesperadas.

No continuar con la capa 2 si `h1` no puede comunicarse con `h2`.

---

## Capa 2 — Ping e iperf3 directos

### Objetivo

Confirmar que un host puede generar tráfico real contra otro sin utilizar todavía el agente HTTP ni el dashboard.

### 2.1. Iniciar un servidor iperf3

Para generar tráfico desde `h1` hacia `h2`, `h2` debe ejecutar primero un servidor:

```bash
mininet> h2 iperf3 -s -D -p 5201
```

Comprobar que escucha en el puerto 5201:

```bash
mininet> h2 ss -ltnp
```

Debe aparecer una entrada asociada al puerto `5201`.

### 2.2. Probar tráfico TCP

Ejecutar desde `h1`:

```bash
mininet> h1 iperf3 -c 10.0.0.2 -p 5201 -t 5
```

La salida debe mostrar la velocidad medida y terminar sin errores de conexión.

### 2.3. Probar tráfico UDP

Ejecutar una transmisión UDP de 10 Mbps durante cinco segundos:

```bash
mininet> h1 iperf3 -c 10.0.0.2 -p 5201 -u -b 10M -t 5
```

La salida debe mostrar:

- Throughput aproximado.
- Jitter.
- Datagramas perdidos.
- Porcentaje de pérdida.

### 2.4. Preparar todos los hosts como destinos

Para poder seleccionar cualquier destino durante las pruebas, iniciar `iperf3` como servidor en todos los hosts:

```bash
mininet> h1 iperf3 -s -D -p 5201
mininet> h2 iperf3 -s -D -p 5201
mininet> h3 iperf3 -s -D -p 5201
mininet> h4 iperf3 -s -D -p 5201
```

Comprobar los procesos:

```bash
mininet> h1 pgrep -a iperf3
mininet> h2 pgrep -a iperf3
mininet> h3 pgrep -a iperf3
mininet> h4 pgrep -a iperf3
```

### Criterio de finalización de la capa 2

- [ ] El servidor `iperf3` está iniciado en `h2`.
- [ ] La prueba TCP desde `h1` termina correctamente.
- [ ] La prueba UDP desde `h1` termina correctamente.
- [ ] La salida UDP contiene throughput, jitter y pérdida.
- [ ] Todos los hosts que se utilizarán como destino ejecutan un servidor `iperf3`.

Si `ping` funciona pero `iperf3` no, comprobar que el servidor está iniciado y que el puerto del cliente coincide con el puerto del servidor.

---

## Capa 3 — Agentes HTTP

### Objetivo

Controlar `ping` e `iperf3` mediante peticiones HTTP. Esta es la misma interfaz que utilizará posteriormente el dashboard.

El agente debe proporcionar estos endpoints:

| Método | Endpoint | Función |
|--------|----------|---------|
| `GET` | `/health` | Comprobar que el agente está disponible |
| `POST` | `/start` | Iniciar ping, TCP o UDP |
| `GET` | `/result` | Consultar estado o resultado |
| `POST` | `/stop` | Detener el trabajo actual |

### 3.1. Iniciar un agente en cada host

Desde la consola de Mininet:

```bash
mininet> h1 python3 /home/USUARIO/SDN_project/HostAgent.py > /tmp/h1-agent.log 2>&1 &
mininet> h2 python3 /home/USUARIO/SDN_project/HostAgent.py > /tmp/h2-agent.log 2>&1 &
mininet> h3 python3 /home/USUARIO/SDN_project/HostAgent.py > /tmp/h3-agent.log 2>&1 &
mininet> h4 python3 /home/USUARIO/SDN_project/HostAgent.py > /tmp/h4-agent.log 2>&1 &
```

> Sustituir la ruta del ejemplo por la ruta real de `HostAgent.py`.

Cada agente escucha en el puerto 5005.

Comprobar que el proceso existe:

```bash
mininet> h1 pgrep -a -f HostAgent.py
mininet> h2 pgrep -a -f HostAgent.py
```

Si un agente no arranca, revisar su log:

```bash
mininet> h1 cat /tmp/h1-agent.log
```

### 3.2. Probar el endpoint de salud

Desde el propio `h1`:

```bash
mininet> h1 curl http://127.0.0.1:5005/health
```

Respuesta esperada:

```json
{
  "running": false,
  "status": "ok"
}
```

También se puede comprobar el agente de otro host a través de la red de Mininet:

```bash
mininet> h1 curl http://10.0.0.2:5005/health
```

### 3.3. Iniciar un ping mediante HTTP

Desde `h1`, enviar una petición al agente local para hacer ping a `h2`:

```bash
mininet> h1 curl -X POST http://127.0.0.1:5005/start -H "Content-Type: application/json" -d '{"type":"ping","target":"10.0.0.2","duration":3}'
```

Respuesta esperada:

```json
{
  "status": "started"
}
```

Consultar el estado:

```bash
mininet> h1 curl http://127.0.0.1:5005/result
```

Mientras se ejecuta:

```json
{
  "done": false,
  "status": "running"
}
```

Al finalizar:

```json
{
  "done": true,
  "status": "completed",
  "packet_loss_pct": 0,
  "avg_rtt_ms": 1.2
}
```

Los valores exactos dependen de la red simulada.

### 3.4. Iniciar tráfico TCP mediante HTTP

Confirmar primero que `h2` ejecuta el servidor `iperf3`:

```bash
mininet> h2 pgrep -a iperf3
```

Iniciar la prueba desde el agente de `h1`:

```bash
mininet> h1 curl -X POST http://127.0.0.1:5005/start -H "Content-Type: application/json" -d '{"type":"tcp","target":"10.0.0.2","dst_port":5201,"duration":5,"streams":1}'
```

Consultar `/result` hasta que `done` sea `true`:

```bash
mininet> h1 curl http://127.0.0.1:5005/result
```

### 3.5. Iniciar tráfico UDP mediante HTTP

Ejecutar una transmisión de 10 Mbps:

```bash
mininet> h1 curl -X POST http://127.0.0.1:5005/start -H "Content-Type: application/json" -d '{"type":"udp","target":"10.0.0.2","dst_port":5201,"bw":10,"duration":5,"streams":1}'
```

Consultar el resultado:

```bash
mininet> h1 curl http://127.0.0.1:5005/result
```

La respuesta final debe contener valores similares a:

```json
{
  "done": true,
  "status": "completed",
  "throughput_mbps": 9.8,
  "jitter_ms": 0.12,
  "lost_pct": 0
}
```

### 3.6. Detener un trabajo

Iniciar una prueba larga:

```bash
mininet> h1 curl -X POST http://127.0.0.1:5005/start -H "Content-Type: application/json" -d '{"type":"udp","target":"10.0.0.2","dst_port":5201,"bw":10,"duration":60,"streams":1}'
```

Detenerla:

```bash
mininet> h1 curl -X POST http://127.0.0.1:5005/stop
```

Respuesta esperada:

```json
{
  "status": "stopped"
}
```

### Criterio de finalización de la capa 3

- [ ] Cada host ejecuta su propio `HostAgent.py`.
- [ ] `/health` responde desde todos los agentes.
- [ ] `/start` puede iniciar un ping.
- [ ] `/result` devuelve el resultado del ping.
- [ ] `/start` puede iniciar una prueba TCP.
- [ ] `/start` puede iniciar una prueba UDP.
- [ ] `/result` devuelve throughput, jitter y pérdida para UDP.
- [ ] `/stop` detiene un trabajo activo.
- [ ] Un segundo `/start` durante un trabajo activo devuelve un error controlado.

---

## Limitación entre Windows y Mininet

Los hosts `10.0.0.1`, `10.0.0.2`, etc. existen dentro de la red virtual creada por Mininet en Linux.

Si Codex y el dashboard se ejecutan en Windows y Mininet se ejecuta en otra máquina o máquina virtual Linux, Windows probablemente no podrá acceder directamente a:

```text
http://10.0.0.1:5005
```

Esto no significa que el agente esté mal implementado. La dirección puede ser accesible únicamente dentro de Mininet.

Para verificar hoy la capa 3, ejecutar las peticiones `curl` desde la consola de Mininet, por ejemplo:

```bash
mininet> h1 curl http://127.0.0.1:5005/health
```

El dashboard podrá conectarse a los agentes si el computador donde se abre el navegador y los computadores Linux están en una red con acceso al puerto 5005.

Para conectar el dashboard de Windows con Mininet antes de disponer del hardware sería necesario añadir una ruta, un proxy o una red de gestión entre Windows y Linux. Eso queda fuera de las capas 1–3.

---

## Resolución rápida de problemas

### `ping` no funciona

```bash
mininet> net
mininet> h1 ip route
mininet> h2 ip route
mininet> h1 ping -c 3 10.0.0.2
```

Comprobar también que ONOS ha descubierto los switches y que existen reglas de forwarding.

### `iperf3: unable to connect to server`

Comprobar el servidor destino:

```bash
mininet> h2 pgrep -a iperf3
mininet> h2 ss -ltnp
```

Volver a iniciarlo:

```bash
mininet> h2 iperf3 -s -D -p 5201
```

### El agente no responde

```bash
mininet> h1 pgrep -a -f HostAgent.py
mininet> h1 cat /tmp/h1-agent.log
mininet> h1 ss -ltnp
```

Comprobar que Flask escucha en `0.0.0.0:5005`.

### `/start` devuelve `409`

Ya existe un trabajo activo. Consultarlo o detenerlo:

```bash
mininet> h1 curl http://127.0.0.1:5005/result
mininet> h1 curl -X POST http://127.0.0.1:5005/stop
```

### `/result` devuelve un error de interpretación

Ejecutar el comando `ping` o `iperf3` directamente desde el host para inspeccionar su salida:

```bash
mininet> h1 ping -c 3 10.0.0.2
mininet> h1 iperf3 -c 10.0.0.2 -p 5201 -t 5 --json
```

---

## Siguiente etapa

Cuando las capas 1–3 estén verificadas, la integración del dashboard seguirá este recorrido:

```text
ExperimentsPage
      │
      ▼
trafficStore.ts
      │
      ▼
rpiAgent.ts
      │ HTTP
      ▼
HostAgent.py
      │
      ├── ping
      └── iperf3
```

Los siguientes archivos previstos por el apartado B1 son:

```text
src/services/rpiAgent.ts
src/stores/trafficStore.ts
src/components/experiments/TrafficGeneratorPanel.tsx
src/pages/ExperimentsPage.tsx
```

---

## Capas 4–6 — Integración implementada en el dashboard

Las capas 4–6 ya están implementadas en el proyecto. Estas capas se pueden compilar y revisar en Windows, pero las peticiones HTTP reales solo funcionarán cuando el navegador tenga una ruta de red hacia los agentes.

### Capa 4 — Servicio TypeScript

Archivo:

```text
src/services/rpiAgent.ts
```

Responsabilidades:

- Normalizar una IP, hostname o URL completa del agente.
- Consultar `GET /health`.
- Enviar `POST /start`.
- Consultar `GET /result`.
- Enviar `POST /stop`.
- Aplicar un timeout de ocho segundos.
- Convertir errores HTTP, CORS y de conectividad en mensajes comprensibles.

Ejemplos de direcciones válidas:

```text
10.0.0.1
mininet-host.local
http://10.0.0.1:5005
```

Si no se especifica protocolo ni puerto, el servicio utiliza:

```text
http://<dirección>:5005
```

#### Verificación de la capa 4

1. Abrir **Experiments**.
2. Seleccionar el host origen. El panel utilizará automáticamente la IP descubierta por ONOS.
3. Pulsar **Test agent**.
4. Si el agente está en otra red de gestión, abrir **Settings**.
5. Buscar **Traffic Generator Agent Overrides**.
6. Configurar únicamente la dirección alternativa del agente y repetir la prueba.

Resultado esperado cuando existe conectividad:

```text
Agent reachable (...); idle.
```

En Windows, mientras Mininet esté aislado en Linux, es esperable obtener:

```text
Cannot reach agent 10.0.0.1. Check its IP, port, CORS and network routing.
```

Ese mensaje confirma que la interfaz y el servicio intentaron realizar la petición; no confirma que exista ruta hasta la red Mininet.

### Capa 5 — Estado Zustand

Archivo:

```text
src/stores/trafficStore.ts
```

El store mantiene:

```text
status         estado global del trabajo
activeJob      origen, destino, parámetros y dirección del agente
latestResult   último estado o resultado recibido
history        últimos 50 experimentos
error          último error visible
isPolling      evita peticiones /result simultáneas
```

Estados posibles:

```text
idle
starting
running
stopping
completed
stopped
failed
```

Flujo de un experimento:

```text
Start
  → status = starting
  → POST /start
  → status = running
  → GET /result cada 2 segundos
  → completed o failed
  → guardar en history
```

Flujo de parada:

```text
Stop
  → status = stopping
  → POST /stop
  → status = stopped
  → guardar en history
```

#### Verificación de la capa 5

- [ ] Al pulsar Start aparece `starting`.
- [ ] Después de responder `/start` aparece `running`.
- [ ] La barra de progreso utiliza `elapsed_sec` recibido del agente.
- [ ] Al finalizar aparece `completed`.
- [ ] El resultado aparece en **Recent runs**.
- [ ] Al pulsar Stop aparece `stopping` y después `stopped`.
- [ ] Un fallo de conexión aparece como `failed` y se guarda en el historial.
- [ ] El botón **Clear** elimina el historial visible.

El historial se mantiene mientras la página está abierta. No se persiste en `localStorage`, para evitar conservar resultados de laboratorio obsoletos entre sesiones.

### Capa 6 — Interfaz React

Archivos:

```text
src/components/experiments/TrafficGeneratorPanel.tsx
src/pages/ExperimentsPage.tsx
src/pages/SettingsPage.tsx
src/stores/settingsStore.ts
```

La interfaz permite:

- Seleccionar un host origen que tenga agente configurado.
- Seleccionar un host destino diferente y con dirección IP.
- Elegir ICMP Ping, TCP Bulk o UDP Constant.
- Configurar puerto, bandwidth, duración y streams.
- Comprobar `/health` con **Test agent**.
- Iniciar y detener el tráfico.
- Consultar el progreso cada dos segundos.
- Mostrar throughput, RTT, jitter y pérdida.
- Mostrar los últimos cinco resultados y conservar hasta 50 en memoria.

La dirección del agente se resuelve con esta prioridad:

```text
1. Override opcional guardado en Settings
2. host.ipAddress descubierto por ONOS y almacenado en networkStore
```

Por tanto, no se necesita una tabla hardcodeada. Si ONOS descubre `h-1` con IP `10.0.0.1`, el dashboard intenta automáticamente `http://10.0.0.1:5005`.

Los overrides opcionales sí se guardan en `localStorage` mediante el middleware `persist` de Zustand. Se utilizan únicamente cuando el agente escucha en una dirección de gestión distinta de la IP de tráfico.

Cuando ONOS descubra hardware real, los IDs pueden ser direcciones MAC como:

```text
00:00:00:00:00:01/None
```

Si el agente es accesible mediante la IP descubierta, no es necesario configurar nada. Si utiliza otra interfaz, abrir Settings y asignar la IP de gestión al nuevo ID como override.

#### Verificación de la capa 6

- [ ] La página Experiments muestra **Traffic Generator**.
- [ ] El origen ofrece hosts online con una IP descubierta.
- [ ] Sin override, **Test agent** utiliza automáticamente `host.ipAddress`.
- [ ] Con override, **Test agent** utiliza la dirección configurada en Settings.
- [ ] El destino no permite seleccionar el mismo host que el origen.
- [ ] Ping desactiva puerto, bandwidth y streams.
- [ ] TCP activa puerto y streams.
- [ ] UDP activa puerto, bandwidth y streams.
- [ ] Start queda desactivado si falta origen o destino.
- [ ] Durante un trabajo los campos quedan bloqueados.
- [ ] Los errores de red son visibles y no bloquean la página.
- [ ] Los resultados finales se muestran sin recargar la página.

### Comprobación TypeScript

Desde `sdn-dashboard`:

```bash
npm run type-check
```

El comando debe terminar sin errores.

### Prueba completa en Linux o hardware

Después de validar individualmente las capas 1–3:

1. Confirmar que el dashboard puede alcanzar `http://<agente>:5005/health`.
2. Abrir Settings y guardar el agente del host origen.
3. Abrir Experiments y pulsar **Test agent**.
4. Probar primero ICMP durante tres segundos.
5. Comprobar el resultado de RTT y pérdida.
6. Iniciar `iperf3 -s -D -p 5201` en el destino.
7. Probar TCP durante cinco segundos.
8. Probar UDP a 10 Mbps durante cinco segundos.
9. Comprobar throughput, jitter y pérdida.
10. Iniciar una prueba larga y verificar el botón Stop.
