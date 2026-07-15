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
sudo apt install python3-flask python3-flask-cors iperf3 curl
```

Comprobar las instalaciones:

```bash
python3 --version
iperf3 --version
curl --version
```

Guardar el agente HTTP en una ruta accesible desde Linux. Por ejemplo:

```text
/home/USUARIO/SDN_project/agent.py
```

Los hosts de Mininet utilizan espacios de red diferentes, pero comparten el sistema de archivos de Linux. Por eso todos pueden ejecutar el mismo archivo `agent.py`.

Antes de iniciar Mininet, comprobar la sintaxis del agente:

```bash
python3 -m py_compile /home/USUARIO/SDN_project/agent.py
```

> Sustituir `/home/USUARIO/SDN_project/agent.py` por la ruta real del archivo.

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
mininet> h1 python3 /home/USUARIO/SDN_project/agent.py > /tmp/h1-agent.log 2>&1 &
mininet> h2 python3 /home/USUARIO/SDN_project/agent.py > /tmp/h2-agent.log 2>&1 &
mininet> h3 python3 /home/USUARIO/SDN_project/agent.py > /tmp/h3-agent.log 2>&1 &
mininet> h4 python3 /home/USUARIO/SDN_project/agent.py > /tmp/h4-agent.log 2>&1 &
```

> Sustituir la ruta del ejemplo por la ruta real de `agent.py`.

Cada agente puede escuchar en el puerto 5000 porque cada host tiene su propio espacio de red.

Comprobar que el proceso existe:

```bash
mininet> h1 pgrep -a -f agent.py
mininet> h2 pgrep -a -f agent.py
```

Si un agente no arranca, revisar su log:

```bash
mininet> h1 cat /tmp/h1-agent.log
```

### 3.2. Probar el endpoint de salud

Desde el propio `h1`:

```bash
mininet> h1 curl http://127.0.0.1:5000/health
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
mininet> h1 curl http://10.0.0.2:5000/health
```

### 3.3. Iniciar un ping mediante HTTP

Desde `h1`, enviar una petición al agente local para hacer ping a `h2`:

```bash
mininet> h1 curl -X POST http://127.0.0.1:5000/start -H "Content-Type: application/json" -d '{"type":"ping","target":"10.0.0.2","duration":3}'
```

Respuesta esperada:

```json
{
  "status": "started"
}
```

Consultar el estado:

```bash
mininet> h1 curl http://127.0.0.1:5000/result
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
mininet> h1 curl -X POST http://127.0.0.1:5000/start -H "Content-Type: application/json" -d '{"type":"tcp","target":"10.0.0.2","dst_port":5201,"duration":5,"streams":1}'
```

Consultar `/result` hasta que `done` sea `true`:

```bash
mininet> h1 curl http://127.0.0.1:5000/result
```

### 3.5. Iniciar tráfico UDP mediante HTTP

Ejecutar una transmisión de 10 Mbps:

```bash
mininet> h1 curl -X POST http://127.0.0.1:5000/start -H "Content-Type: application/json" -d '{"type":"udp","target":"10.0.0.2","dst_port":5201,"bw":10,"duration":5,"streams":1}'
```

Consultar el resultado:

```bash
mininet> h1 curl http://127.0.0.1:5000/result
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
mininet> h1 curl -X POST http://127.0.0.1:5000/start -H "Content-Type: application/json" -d '{"type":"udp","target":"10.0.0.2","dst_port":5201,"bw":10,"duration":60,"streams":1}'
```

Detenerla:

```bash
mininet> h1 curl -X POST http://127.0.0.1:5000/stop
```

Respuesta esperada:

```json
{
  "status": "stopped"
}
```

### Criterio de finalización de la capa 3

- [ ] Cada host ejecuta su propio `agent.py`.
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
http://10.0.0.1:5000
```

Esto no significa que el agente esté mal implementado. La dirección puede ser accesible únicamente dentro de Mininet.

Para verificar hoy la capa 3, ejecutar las peticiones `curl` desde la consola de Mininet, por ejemplo:

```bash
mininet> h1 curl http://127.0.0.1:5000/health
```

Cuando se utilice hardware físico, el dashboard podrá conectarse a los agentes si Windows y las Raspberry Pi están en la misma red y el puerto 5000 es accesible.

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
mininet> h1 pgrep -a -f agent.py
mininet> h1 cat /tmp/h1-agent.log
mininet> h1 ss -ltnp
```

Comprobar que Flask escucha en `0.0.0.0:5000`.

### `/start` devuelve `409`

Ya existe un trabajo activo. Consultarlo o detenerlo:

```bash
mininet> h1 curl http://127.0.0.1:5000/result
mininet> h1 curl -X POST http://127.0.0.1:5000/stop
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
agent.py
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

