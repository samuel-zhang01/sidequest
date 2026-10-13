#!/usr/bin/env python3
"""Full maintained browser regressions against generated data and a private stack."""
import csv
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]


def run(args, cwd=ROOT, **kwargs):
    return subprocess.run([str(value) for value in args], cwd=cwd, check=True, **kwargs)


def api(path, payload=None, cookie=None):
    headers = {'Content-Type': 'application/json'}
    if cookie:
        headers['Cookie'] = cookie
    request = urllib.request.Request('http://127.0.0.1:6969' + path,
                                    data=json.dumps(payload).encode() if payload is not None else None,
                                    headers=headers)
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read()), response.headers.get('Set-Cookie')


def main():
    os.umask(0o077)
    # Preserve the single published application-port contract. Never stop or
    # reuse another process if this local CI port is occupied.
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 6969))
    project = 'sidequest-ci-' + uuid.uuid4().hex[:16]
    with tempfile.TemporaryDirectory(prefix=project + '-', dir=os.environ.get('RUNNER_TEMP')) as temporary:
        work = Path(temporary)
        source = work / 'source'
        source.mkdir()
        (source / 'api/agent').mkdir(parents=True)
        # Explicit source allowlist: no private .env, export, media or DB tree
        # is enumerated or copied into the test stack.
        for name in ('index.html', 'live.html', 'live.js', 'api/server.js',
                     'api/agent/contracts.js', 'api/agent/godoy.js',
                     'api/package.json', 'api/package-lock.json'):
            shutil.copyfile(ROOT / name, source / name)
        shutil.copyfile(ROOT / 'nginx/default.conf', source / 'nginx.conf')
        for name in ('live.js', 'api/server.js', 'api/agent/contracts.js', 'api/agent/godoy.js'):
            run(['node', '--check', source / name])
        for filename in ('index.html', 'live.html'):
            for index, script in enumerate(re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>',
                                                      (source / filename).read_text(), re.S)):
                path = work / (filename + '-' + str(index) + '.js')
                path.write_text(script)
                run(['node', '--check', path])
        run(['npm', 'ci', '--omit=dev', '--no-audit', '--no-fund'], cwd=source / 'api')
        with (work / 'generated-activities.csv').open('w', newline='') as output:
            writer = csv.writer(output)
            writer.writerow(['Activity ID', 'Activity Date', 'Activity Type', 'Moving Time',
                             'Distance', 'Distance', 'Elapsed Time', 'Elapsed Time',
                             'Average Heart Rate', 'Max Heart Rate', 'Max Heart Rate',
                             'Elevation Gain', 'Perceived Exertion'])
            for index in range(209):
                date = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=208-index)
                writer.writerow(['synthetic-' + str(index), date.isoformat(), 'Run', 1500+index,
                                 5, 5000+index, 1600+index, 1600+index, 125, 150, 150, 20, 4])
        common = {'restart': 'no', 'security_opt': ['no-new-privileges:true'],
                  'pids_limit': 128, 'cpus': 1}
        config = {'services': {
            'db': {**common, 'image': 'postgres:16-alpine', 'mem_limit': '512m',
                   'environment': {'POSTGRES_USER': 'sidequest_ci', 'POSTGRES_PASSWORD': 'disposable-ci-only', 'POSTGRES_DB': 'sidequest_ci'},
                   'volumes': ['data:/var/lib/postgresql/data'], 'networks': ['data'],
                   'healthcheck': {'test': ['CMD', 'pg_isready', '-U', 'sidequest_ci', '-d', 'sidequest_ci'], 'interval': '2s', 'timeout': '2s', 'retries': 30}},
            'api': {**common, 'image': 'node:22-alpine', 'mem_limit': '256m',
                    'working_dir': '/app', 'command': ['node', 'server.js'],
                    'environment': {'PORT': '8080', 'DATABASE_URL': 'postgresql://sidequest_ci:disposable-ci-only@db:5432/sidequest_ci',
                                    'STRAVA_ACTIVITIES_PATH': '/fixtures/generated.csv',
                                    'STRAVA_OWNER_USER_ID': 'user-javi', 'STRAVA_OWNER_HANDLE': 'javi',
                                    'GEMINI_API_KEY': '', 'OPENAI_API_KEY': ''},
                    'volumes': [str(source / 'api') + ':/app:ro', str(work / 'generated-activities.csv') + ':/fixtures/generated.csv:ro'],
                    'networks': ['data'], 'depends_on': {'db': {'condition': 'service_healthy'}},
                    'healthcheck': {'test': ['CMD-SHELL', 'wget -q -O /dev/null http://127.0.0.1:8080/health'], 'interval': '2s', 'timeout': '2s', 'retries': 30}},
            'web': {**common, 'image': 'nginx:1.27-alpine', 'mem_limit': '128m',
                    'ports': ['127.0.0.1:6969:80'], 'networks': ['data', 'edge'],
                    'volumes': [str(source / name) + ':/usr/share/nginx/html/' + name + ':ro' for name in ('index.html','live.html','live.js')]
                               + [str(source / 'nginx.conf') + ':/etc/nginx/conf.d/default.conf:ro'],
                    'depends_on': {'api': {'condition': 'service_healthy'}}}},
                  'networks': {'data': {'internal': True}, 'edge': {}}, 'volumes': {'data': {}}}
        path = work / 'compose.json'
        path.write_text(json.dumps(config))
        compose = ['docker', 'compose', '-p', project, '-f', str(path)]
        try:
            run([*compose, 'config', '--quiet'])
            run([*compose, 'up', '-d', '--wait', '--wait-timeout', '120'])
            for _ in range(30):
                try:
                    status, _ = api('/api/status')
                    if status['database'] == 'connected':
                        break
                except (OSError, ValueError):
                    time.sleep(1)
            else:
                raise RuntimeError('Generated fixture stack did not become ready')
            assert status['generationMode'] == 'deterministic-fallback'
            _, cookie = api('/api/auth/join', {})
            assert cookie
            # Seed the documented starter+generated challenge contract through
            # the real mocked-provider application flow before navigation.
            api('/api/agent-godoy/analyse', {}, cookie.split(';',1)[0])
            loop, _ = api('/api/feedback-loop', cookie=cookie.split(';',1)[0])
            assert int(loop['source']['runCount']) == 209
            assert loop['source']['adapter'] == 'strava-export-v1'
            assert len(loop['challengeTemplates']) >= 6
            env = {**os.environ, 'APP_URL': 'http://127.0.0.1:6969'}
            for name in ('test:navigation', 'test:challenge', 'test:live'):
                run(['npm', 'run', name], env=env)
            print(json.dumps({'synthetic_rows': 209, 'provider': 'deterministic-fallback',
                              'maintained_gates': ['navigation','challenge-objects','live-phone','live-modes'],
                              'published_application_port': 6969, 'project': project, 'status': 'passed'}))
        finally:
            # This random project was created here; production names, data,
            # networks, keys and containers are never selected for cleanup.
            run([*compose, 'down', '--volumes', '--remove-orphans'])


if __name__ == '__main__':
    main()
