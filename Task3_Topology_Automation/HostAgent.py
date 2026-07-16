from flask import Flask, jsonify, request
import subprocess
import json
import re


app = Flask(__name__)
current_proc = None
current_type = None


# The dashboard and the agent run at different web addresses.
# These headers allow the browser to make that connection.
@app.after_request
def allow_dashboard_requests(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return response



@app.route('/ping/<target>')
def ping(target):
    out = subprocess.run(
        ['ping', '-c', '5', '-W', '1', target],
        capture_output=True, text=True
    ).stdout
    m = re.search(r'rtt min/avg/max.*?= [\d.]+/([\d.]+)/', out)
    return jsonify({'rtt_ms': float(m.group(1)) if m else None, 'target': target})


# Used only by the dashboard's "Test agent" button.
@app.route('/health')
def health():
    return jsonify({
        'status': 'ok',
        'running': current_proc is not None and current_proc.poll() is None,
    })


@app.route('/start', methods=['POST'])
def start():
    global current_proc, current_type

    d = request.json
    current_type = d['type']

    if current_type == 'ping':
        cmd = ['ping', '-c', str(d['duration']), d['target']]
    else:
        cmd = [
            'iperf3', '-c', d['target'],
            '-p', str(d['dst_port']),
            '-t', str(d['duration']),
            '-P', str(d.get('streams', 1)),
            '--json',
        ]
        if 'udp' in current_type:
            cmd.extend(['-u', '-b', f"{d['bw']}M"])

    current_proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    return jsonify({'status': 'started'})


@app.route('/stop', methods=['POST'])
def stop():
    if current_proc and current_proc.poll() is None:
        current_proc.terminate()
    return jsonify({'status': 'stopped'})


@app.route('/result')
def result():
    if not current_proc or current_proc.poll() is None:
        return jsonify({'done': False})

    out, _ = current_proc.communicate()

    if current_type == 'ping':
        loss = re.search(r'([\d.]+)% packet loss', out)
        rtt = re.search(r'=\s*[\d.]+/([\d.]+)/[\d.]+/[\d.]+\s*ms', out)
        return jsonify({
            'done': True,
            'avg_rtt_ms': float(rtt.group(1)) if rtt else None,
            'packet_loss_pct': float(loss.group(1)) if loss else None,
        })

    try:
        data = json.loads(out)
        end = data['end']
        summary = end.get('sum_received') or end.get('sum') or {}
        return jsonify({
            'done': True,
            'throughput_mbps': summary.get('bits_per_second', 0) / 1e6,
            'retransmits': end.get('sum_sent', {}).get('retransmits', 0),
            'jitter_ms': end.get('sum', {}).get('jitter_ms', 0),
            'lost_pct': end.get('sum', {}).get('lost_percent', 0),
        })
    except:
        return jsonify({'done': True, 'error': 'parse failed'})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5005)
