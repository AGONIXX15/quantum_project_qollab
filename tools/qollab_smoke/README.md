# Arnés de humo para Qollab

Herramienta desechable para comprobar en Qollab que cada función pública de `quantum/api.py` responde sin fallar. **No forma parte de la entrega final.**

## Construir y subir

1. Desde la raíz del repo: `tools/build_smoke.sh` (crea `dist/qollab_smoke/`).
2. Sube el contenido de `dist/qollab_smoke/` como un proyecto JS nuevo en Qollab (`index.html`, `main.js`, `main.css`, `quantum/`, `data/`, `requirements.txt` en la raíz). Rutas de archivos: máx. 100 archivos, 2 MB cada uno.
3. Elige el backend en "Select QPU" y pulsa Run. Qollab crea la variable global `backend` (mismo patrón que `preflight/qollab_probe`): el JS la pasa de forma POSICIONAL (`fn.callPromising(backend, ...)`, patrón probado). `run_level` recibe un dict de parámetros: `run_level.callPromising(backend, 'link', {shots: 300})`.
- [ ] Pulsa primero "Diagnose backend": hace dos llamadas posicionales seguidas y una con `callPromisingKwargs({backend})`. `same_object` debe ser YES; **si es NO, avisa a Claude de inmediato** (la protección por backend no funcionaría). `kwargs_works` dice si los kwargs funcionan.

## Lista de comprobación

BasicSimulator:
- [ ] Todos los botones terminan en OK (info, 6 niveles, rescue, run_level x3, full_batch, load_recorded, export_result).
- [ ] Anota el tiempo (ms) de cada llamada en la tabla; ningún botón se queda en "Running".
- [ ] `load_recorded` devuelve `mode: "recorded"`.

Simulador IonQ Aria (un trabajo por ejecución; pulsa Stop y Run entre pruebas si quieres repetir):
- [ ] `run_level link` (1.er clic): OK con `source: ionq_packed` (un trabajo, un circuito, ~13 s). Luego `run_level swap` y `run_level rescue` en la misma ejecución: `ionq_job_used` con `fallback` (esperado, 1 Run = 1 nivel). Repite en Run nuevos para swap y rescue (rescue sale con `ionq_reduced: true` en Forte sim 29 / Aria 25).
- [ ] `full_batch`: debe fallar con `ionq_use_run_level` (el proxy rechaza multi-circuito; no envía nada).
- [ ] La protección es POR OBJETO backend (Qollab crea uno nuevo en cada Run): después de los pasos anteriores pulsa Stop y Run otra vez y luego "Diagnose backend"; se espera `ionq_job_used: false` (backend nuevo). Dentro de la misma ejecución debe seguir en `true`.
- [ ] Los botones `level_*` sueltos deben dar `ionq_use_run_level` (esperado).
- [ ] En una ejecución nueva: `run_level` de un nivel y luego `export_result` (último resultado; la grabación IonQ completa ya no se puede hacer con `full_batch`: hay que grabar nivel por nivel). Guarda el JSON descargado como `data/recorded/ionq_aria_sim_full.json` y registra un opener en `quantum/api.py`:
  `def _open_ionq_aria_sim_full(): return open("data/recorded/ionq_aria_sim_full.json", encoding="utf-8")` (ruta LITERAL) y añádelo a `RECORDED_OPENERS`.
  Ojo: `export_result` exporta el último resultado mostrado; el JSON debe pesar menos de 2 MB.

## Importante

`tools/` y `dist/` deben excluirse de la subida final a Qollab (`dist/` ya está en `.gitignore`). Los registros en `data/recorded/` se regeneran con `uv run python tools/record_run.py`.
