from flask import Flask, jsonify, request
from flask_cors import CORS

import ipaddress
import json
import os
import re
import signal
import subprocess
import time


app = Flask(__name__)

# Para desarrollo. En hardware real conviene limitar los orígenes.
CORS(app)

current_process = None
current_job = None


def integer_parameter(data, name, default, minimum, maximum):
    try:
        value = int(data.get(name, default))
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be an integer")

    if not minimum <= value <= maximum:
        raise ValueError(
            f"{name} must be between {minimum} and {maximum}"
        )

    return value


def float_parameter(data, name, default, minimum, maximum):
    try:
        value = float(data.get(name, default))
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a number")

    if not minimum <= value <= maximum:
        raise ValueError(
            f"{name} must be between {minimum} and {maximum}"
        )

    return value


def validate_target(value):
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        raise ValueError("target must be a valid IPv4 or IPv6 address")


def parse_iperf_result(output):
    data = json.loads(output)
    end = data.get("end", {})

    # TCP suele utilizar sum_received.
    # UDP normalmente utiliza sum.
    summary = (
        end.get("sum_received")
        or end.get("sum")
        or end.get("sum_sent")
        or {}
    )

    return {
        "throughput_mbps": round(
            summary.get("bits_per_second", 0) / 1_000_000,
            3,
        ),
        "jitter_ms": round(
            summary.get("jitter_ms", 0),
            3,
        ),
        "lost_pct": round(
            summary.get("lost_percent", 0),
            3,
        ),
        "retransmits": summary.get(
            "retransmits",
            end.get("sum_sent", {}).get("retransmits", 0),
        ),
    }


def parse_ping_result(output):
    packet_loss = None
    average_rtt = None

    loss_match = re.search(
        r"([\d.]+)% packet loss",
        output,
    )

    if loss_match:
        packet_loss = float(loss_match.group(1))

    # Ejemplo:
    # rtt min/avg/max/mdev = 0.041/0.060/0.083/0.017 ms
    rtt_match = re.search(
        r"=\s*[\d.]+/([\d.]+)/[\d.]+/[\d.]+\s*ms",
        output,
    )

    if rtt_match:
        average_rtt = float(rtt_match.group(1))

    return {
        "packet_loss_pct": packet_loss,
        "avg_rtt_ms": average_rtt,
    }


def stop_current_process():
    global current_process

    if current_process is None:
        return False

    if current_process.poll() is None:
        try:
            os.killpg(
                os.getpgid(current_process.pid),
                signal.SIGTERM,
            )
            current_process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            os.killpg(
                os.getpgid(current_process.pid),
                signal.SIGKILL,
            )
        except ProcessLookupError:
            pass

    return True


@app.get("/health")
def health():
    return jsonify({
        "status": "ok",
        "hostname": os.uname().nodename,
        "running": (
            current_process is not None
            and current_process.poll() is None
        ),
    })


@app.post("/start")
def start():
    global current_process
    global current_job

    if (
        current_process is not None
        and current_process.poll() is None
    ):
        return jsonify({
            "error": "another traffic job is already running"
        }), 409

    data = request.get_json(silent=True) or {}

    try:
        traffic_type = str(
            data.get("type", "ping")
        ).lower()

        target = validate_target(data.get("target", ""))

        duration = integer_parameter(
            data,
            "duration",
            default=10,
            minimum=1,
            maximum=3600,
        )

        if traffic_type == "ping":
            command = [
                "ping",
                "-c",
                str(duration),
                target,
            ]

        elif traffic_type in ("tcp", "tcp-bulk", "udp", "udp-cbr"):
            destination_port = integer_parameter(
                data,
                "dst_port",
                default=5201,
                minimum=1,
                maximum=65535,
            )

            bandwidth = float_parameter(
                data,
                "bw",
                default=10,
                minimum=0.1,
                maximum=10000,
            )

            streams = integer_parameter(
                data,
                "streams",
                default=1,
                minimum=1,
                maximum=32,
            )

            command = [
                "iperf3",
                "-c",
                target,
                "-p",
                str(destination_port),
                "-t",
                str(duration),
                "-P",
                str(streams),
                "--json",
            ]

            if traffic_type in ("udp", "udp-cbr"):
                command.extend([
                    "-u",
                    "-b",
                    f"{bandwidth}M",
                ])

        else:
            return jsonify({
                "error": f"unsupported traffic type: {traffic_type}"
            }), 400

    except ValueError as error:
        return jsonify({
            "error": str(error)
        }), 400

    try:
        current_process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            start_new_session=True,
        )
    except FileNotFoundError:
        return jsonify({
            "error": f"command not found: {command[0]}"
        }), 500

    current_job = {
        "type": traffic_type,
        "target": target,
        "command": command,
        "started_at": time.time(),
        "duration": duration,
    }

    return jsonify({
        "status": "started",
        "pid": current_process.pid,
        "job": current_job,
    })


@app.post("/stop")
def stop():
    global current_process
    global current_job

    stopped = stop_current_process()

    current_process = None
    current_job = None

    return jsonify({
        "status": "stopped" if stopped else "idle",
    })


@app.get("/result")
def result():
    global current_process
    global current_job

    if current_process is None or current_job is None:
        return jsonify({
            "done": True,
            "status": "idle",
        })

    return_code = current_process.poll()

    if return_code is None:
        elapsed = time.time() - current_job["started_at"]

        return jsonify({
            "done": False,
            "status": "running",
            "elapsed_sec": round(elapsed, 1),
            "duration_sec": current_job["duration"],
            "job": current_job,
        })

    output, _ = current_process.communicate()
    job = current_job

    current_process = None
    current_job = None

    if return_code != 0:
        return jsonify({
            "done": True,
            "status": "failed",
            "exit_code": return_code,
            "error": output[-2000:],
        })

    try:
        if job["type"] == "ping":
            metrics = parse_ping_result(output)
        else:
            metrics = parse_iperf_result(output)

        return jsonify({
            "done": True,
            "status": "completed",
            "job": job,
            **metrics,
        })

    except (json.JSONDecodeError, KeyError, TypeError) as error:
        return jsonify({
            "done": True,
            "status": "failed",
            "error": f"could not parse command result: {error}",
            "raw_output": output[-2000:],
        }), 500


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=False,
        use_reloader=False,
    )