# Laboratorio: reproducir el recorrido en un solo equipo

Reproduce en una máquina (Linux/macOS; en Windows usar WSL2 o seguir `docs/04-runbooks/windows.md`) lo que se comprobó en el entorno Cloud el 8 oct 2026: Paperclip real → adaptador `hermes_gateway` → Hermes API server real → modelo **simulado**.

Requisitos: Node ≥ 24.11 (`node -v`), pnpm 10, Python 3.14 con `uv`, usuario sin privilegios (PostgreSQL embebido no arranca como root).

## 1. Modelo simulado (puerto 8700)

```sh
node lab/stub-llm/server.mjs            # imprime "stub-llm (MODELO SIMULADO) escuchando…"
curl -s http://127.0.0.1:8700/v1/models
```

## 2. Hermes con API server (puerto 8642)

```sh
git clone https://github.com/NousResearch/hermes-agent ~/hermes-agent && cd ~/hermes-agent
git checkout a28a5d03a9fa60418db5f44f3436fa2aa029c8f2    # commit verificado el 2026-10-08 (mismo que fijan los scripts de instalación); sin fijarlo, `main` puede diferir
uv sync --python 3.14 && uv pip install --python .venv/bin/python aiohttp
mkdir -p ~/mc-lab/hermes-home && cp <repo>/mission-control/lab/hermes-home.template/config.yaml ~/mc-lab/hermes-home/
KEY=$(python3 -c 'import secrets;print(secrets.token_hex(24))')
printf 'OPENAI_API_KEY=stub-key-not-real\nAPI_SERVER_KEY=%s\n' "$KEY" > ~/mc-lab/hermes-home/.env && chmod 600 ~/mc-lab/hermes-home/.env
HERMES_HOME=~/mc-lab/hermes-home .venv/bin/hermes gateway run
curl -s http://127.0.0.1:8642/health
curl -s -H "Authorization: Bearer $KEY" http://127.0.0.1:8642/v1/capabilities | head -c 300
```

## 3. Paperclip (puerto 3100)

```sh
npx paperclipai@2026.1005.0 onboard --yes -d ~/mc-lab/paperclip-data --no-install-service --run
curl -s http://127.0.0.1:3100/api/health
```

## 4. Recorrido (script)

`node lab/e2e.mjs` crea empresa, secreto, agente `hermes_gateway`, tarea con revisión humana, espera el run, comprueba la marca `MC-STUB-OK` en los comentarios, hace la revisión como operador y escribe un informe en `lab/.runtime/e2e-<fecha>.md`. Variables: `PAPERCLIP_URL` (def. http://127.0.0.1:3100), `HERMES_URL` (def. http://127.0.0.1:8642), `HERMES_API_KEY` (obligatoria).

Qué NO demuestra este laboratorio: calidad de un modelo real, red entre equipos, HTTPS en tailnet, Windows/macOS como servicio.
