# Prueba del Traffic Generator con computadores Linux

Esta guía describe cómo probar el Traffic Generator usando computadores Linux como hosts físicos.

## Configuración utilizada

- El agente se ejecuta en cada computador Linux.
- El agente escucha en el puerto `5005`.
- ONOS descubre la misma IP que tiene cada computador Linux.
- Los campos **Traffic Generator Agent Overrides** se dejan vacíos.
- El dashboard obtiene automáticamente las IP de los hosts desde la topología descubierta por ONOS.

Ejemplo:

```text
H1: 10.0.0.1
H2: 10.0.0.2
H3: 10.0.0.3
```

---

## 1. Preparar cada computador Linux

Instalar Python, Flask, ping, iperf3 y curl:

```bash
sudo apt update
sudo apt install python3 python3-flask iputils-ping iperf3 curl
```

Comprobar que los programas están disponibles:

```bash
python3 --version
iperf3 --version
ping -V
curl --version
```

---

## 2. Copiar el agente

Copiar este archivo en cada computador Linux:

```text
Task3_Topology_Automation/HostAgent.py
```

Por ejemplo, guardarlo en:

```text
/home/usuario/SDN_project/HostAgent.py
```

Comprobar su sintaxis:

```bash
python3 -m py_compile /home/usuario/SDN_project/HostAgent.py
```

Si el comando no muestra ningún mensaje, la sintaxis es correcta.

---

## 3. Confirmar la IP de cada computador

En cada computador Linux:

```bash
hostname -I
```

También se puede identificar la interfaz correspondiente:

```bash
ip -br address
```

Ignorar:

```text
127.0.0.1
```

Esa dirección solo representa al propio computador.

Comparar la IP real con la dirección que muestra ONOS para ese host.

Ejemplo correcto:

```text
Linux H1: 10.0.0.1
ONOS H1:  10.0.0.1
```

Si coinciden, no se debe configurar un Agent Override.

---

## 4. Iniciar el agente

En cada computador Linux:

```bash
python3 /home/usuario/SDN_project/HostAgent.py
```

El terminal debería mostrar que Flask está escuchando en el puerto `5005`.

Aunque aparezca:

```text
Running on http://127.0.0.1:5005
```

el agente está configurado con `0.0.0.0`, por lo que escucha mediante las interfaces de red del computador.

Para dejarlo ejecutándose en segundo plano:

```bash
nohup python3 /home/usuario/SDN_project/HostAgent.py > /tmp/host-agent.log 2>&1 &
```

Comprobar el proceso:

```bash
pgrep -a -f HostAgent.py
```

Consultar el log:

```bash
cat /tmp/host-agent.log
```

Comprobar el puerto:

```bash
ss -ltnp | grep 5005
```

La salida debería indicar que escucha en:

```text
0.0.0.0:5005
```

---

## 5. Comprobar el agente localmente

Desde el mismo computador Linux:

```bash
curl http://127.0.0.1:5005/health
```

Respuesta esperada:

```json
{
  "status": "ok",
  "running": false
}
```

Después, probar usando la IP real:

```bash
curl http://10.0.0.1:5005/health
```

Cambiar `10.0.0.1` por la IP del computador correspondiente.

---

## 6. Comprobar el acceso desde el computador del dashboard

Desde el computador donde se abre el dashboard:

```bash
curl http://10.0.0.1:5005/health
curl http://10.0.0.2:5005/health
curl http://10.0.0.3:5005/health
```

Todos los agentes deben responder antes de probar desde la interfaz.

Si Linux tiene activado UFW y el puerto está bloqueado:

```bash
sudo ufw allow 5005/tcp
```

Después, repetir la prueba con `curl`.

---

## 7. Preparar los servidores iperf3

Ping no necesita un servidor adicional.

Las pruebas TCP Bulk y UDP CBR necesitan que `iperf3` esté escuchando en el computador destino.

En cada computador que pueda ser destino:

```bash
iperf3 -s -D -p 5201
```

Comprobar:

```bash
ss -ltnp | grep 5201
```

Para detener el servidor:

```bash
pkill iperf3
```

---

## 8. Comprobar la conectividad sin el dashboard

Antes de utilizar la interfaz, probar directamente entre hosts.

Desde H1 hacia H2:

```bash
ping -c 3 10.0.0.2
```

Prueba TCP:

```bash
iperf3 -c 10.0.0.2 -p 5201 -t 5
```

Prueba UDP:

```bash
iperf3 -c 10.0.0.2 -p 5201 -u -b 10M -t 5
```

Si estos comandos no funcionan, primero se deben revisar las reglas de ONOS, la conectividad y el servidor iperf3.

---

## 9. Configurar el dashboard

Abrir **Settings**.

En **Traffic Generator Agent Overrides**, dejar vacíos los campos de los hosts.

Esto hace que el dashboard utilice automáticamente las IP descubiertas por ONOS:

```text
H1 descubierto como 10.0.0.1
→ agente: http://10.0.0.1:5005
```

Usar un override solamente si la IP descubierta por ONOS no permite acceder al agente desde el computador del dashboard.

---

## 10. Probar el botón Test Agent

Abrir la página **Experiments** y el panel del Traffic Generator.

Seleccionar un host origen y pulsar **Test Agent**.

Resultado esperado:

```text
Agent online
```

Si falla, probar nuevamente desde un terminal:

```bash
curl http://IP_DEL_HOST:5005/health
```

---

## 11. Prueba 1: ICMP Ping

En el dashboard:

1. Seleccionar H1 como origen.
2. Seleccionar H2 como destino.
3. Seleccionar **ICMP Ping**.
4. Elegir una duración corta.
5. Pulsar **Start**.

Resultado esperado:

- RTT promedio visible.
- Pérdida de paquetes cercana a `0%`.

Después:

1. Eliminar o modificar la regla de ONOS que permite H1 → H2.
2. Ejecutar nuevamente el ping.

Resultado esperado:

- Pérdida cercana a `100%`.
- El RTT puede aparecer vacío porque no hubo respuestas.

Restaurar la regla antes de continuar.

---

## 12. Prueba 2: UDP CBR

Confirmar primero que H2 ejecuta:

```bash
iperf3 -s -D -p 5201
```

En el dashboard:

1. Seleccionar H1 → H2.
2. Seleccionar **UDP CBR**.
3. Usar el puerto destino `5201`.
4. Seleccionar el ancho de banda.
5. Pulsar **Start**.

Resultado esperado:

- Throughput aproximado al ancho de banda solicitado.
- Métricas de jitter.
- Porcentaje de paquetes perdidos.

Después se puede instalar una regla METER en ONOS y repetir la prueba.

El throughput debería aproximarse al límite del METER.

---

## 13. Prueba 3: TCP Bulk

Confirmar que el destino ejecuta:

```bash
iperf3 -s -D -p 5201
```

En el dashboard:

1. Seleccionar el host origen.
2. Seleccionar el host destino.
3. Seleccionar **TCP Bulk**.
4. Usar el puerto `5201`.
5. Pulsar **Start**.

Resultado esperado:

- Throughput TCP alcanzado.
- Número de retransmisiones.
- Actividad en los enlaces del camino utilizado.

Después se puede cambiar el camino mediante las reglas de ONOS y repetir la prueba.

---

## 14. Limitación de pruebas simultáneas

Cada computador Linux ejecuta un solo agente con una variable `current_proc`.

Es posible ejecutar:

```text
H1 → H2
H3 → H2
```

porque H1 y H3 tienen agentes distintos.

No se deben iniciar simultáneamente:

```text
H1 → H2
H1 → H3
```

porque las dos pruebas utilizarían el mismo agente de H1.

---

## 15. Diagnóstico rápido

### Test Agent no responde

En el host:

```bash
pgrep -a -f HostAgent.py
ss -ltnp | grep 5005
curl http://127.0.0.1:5005/health
```

Desde el computador del dashboard:

```bash
curl http://IP_DEL_HOST:5005/health
```

### Ping no funciona

Probar directamente:

```bash
ping -c 3 IP_DESTINO
```

Revisar las reglas de ONOS y la conectividad física.

### iperf3 no funciona

En el destino:

```bash
ss -ltnp | grep 5201
```

Si no aparece nada:

```bash
iperf3 -s -D -p 5201
```

Después, probar directamente desde el origen:

```bash
iperf3 -c IP_DESTINO -p 5201 -t 5
```

### El navegador muestra un error CORS

Confirmar que se está utilizando la versión actual de `HostAgent.py`.

Reiniciar el agente después de copiar el archivo:

```bash
pkill -f HostAgent.py
nohup python3 /home/usuario/SDN_project/HostAgent.py > /tmp/host-agent.log 2>&1 &
```


```
udo iptables -t nat -A POSTROUTING \
  -s 10.42.0.0/24 -d 10.0.0.0/24 \
  -o INTERFAZ_SDN -j MASQUERADE
Permite también el forwarding:
sudo iptables -A FORWARD \
  -s 10.42.0.0/24 -d 10.0.0.0/24 \
  -p tcp --dport 5005 -j ACCEPT

sudo iptables -A FORWARD \
  -s 10.0.0.0/24 -d 10.42.0.0/24 \
  -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

```
---

## Checklist final

- [ ] Flask, ping, curl e iperf3 están instalados.
- [ ] `HostAgent.py` se ejecuta en cada computador Linux.
- [ ] Cada agente escucha en `0.0.0.0:5005`.
- [ ] ONOS descubre la misma IP configurada en cada computador.
- [ ] Los campos Agent Overrides están vacíos.
- [ ] El computador del dashboard puede consultar `/health`.
- [ ] Los destinos de TCP y UDP ejecutan `iperf3 -s -D -p 5201`.
- [ ] Ping funciona directamente antes de probarlo en el dashboard.
- [ ] iperf3 funciona directamente antes de probarlo en el dashboard.
- [ ] Solo se inicia una prueba simultánea por host origen.
