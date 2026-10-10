/*
  Internationalisation (EN / ES). English is the default; the choice is NOT
  persisted (Qollab has no storage), so every load starts in English.

  - t(key, vars)      -> string in the current language ({name} placeholders).
  - applyI18n(root)   -> fills every [data-i18n], [data-i18n-html],
                         [data-i18n-aria] and [data-i18n-title] element.
  - setLang / onLangChange / getLang manage the language and re-render hooks.

  *-html entries are OUR OWN static markup (never backend data). Backend
  strings (backend name, error, notes...) are always inserted with textContent.
*/

const EN = {
  // --- static page ---------------------------------------------------------
  "app.title": "Entangle the Andes",
  "app.sub": "Colombia's quantum internet · Bogotá · Medellín · Cali",
  "doc.title": "Entangle the Andes · Colombia's quantum internet",
  "loader.text": "Weaving the quantum network…",
  "level.label": "Level",
  "run": "Run",
  "results.title": "Results",
  "results.empty": "Pick a level and press Run.",
  "results.region": "Results",
  "badge.backend": "backend: {name}",
  "badge.partners": "Qollab × IonQ",
  "lang.button": "Español",
  "lang.aria": "Cambiar a español (switch language to Spanish)",
  "footer.attribution": "This effort is supported by Qollab & IonQ.",
  "cities.title": "Cities (QPU nodes)",
  "cities.aria": "Cities of the network",
  "cities.hint": "Select a city to see its details.",
  "params.title": "Parameters",
  "controls.region": "Controls",
  "scene.aria": "3D map of Colombia with the quantum network links",
  "geo.colombia": "COLOMBIA", "geo.panama": "PANAMA", "geo.venezuela": "VENEZUELA", "geo.ecuador": "ECUADOR",
  "geo.peru": "PERU", "geo.brazil": "BRAZIL",
  "geo.caribbean": "Caribbean Sea", "geo.pacific": "Pacific Ocean",
  "geo.cord_w": "Western Cordillera", "geo.cord_c": "Central Cordillera", "geo.cord_e": "Eastern Cordillera",
  "geo.llanos": "Llanos", "geo.amazon": "Amazon",
  "link.idle": "not measured", "link.healthy": "healthy", "link.degraded": "degraded", "link.broken": "broken",
  "link.rescued": "rescued",
  "link.km": "{km} km great-circle",
  "tip.link.gc": "Great-circle distance: {km} km",
  "tip.link.fibre": "Assumed fibre route: {km} km (x1.3, not surveyed)",
  "tip.link.eta": "One-photon survival: {eta}",
  "tip.link.f": "Last result: F = {F} ({status})",
  "footer.mapdata": "Map data: NASA Blue Marble · Terrain Tiles (Mapzen/AWS)",

  // --- legend --------------------------------------------------------------
  "legend.toggle": "Legend",
  "legend.photons": "Photons (Bell pairs)",
  "legend.p0": "Blue/cyan: <b>equal</b> result (parity 0): healthy correlation",
  "legend.p1": "Orange: <b>different</b> result (parity 1): error / noise / spy",
  "legend.fiber": "Fiber links",
  "legend.healthy": "Healthy (F ≥ 0.9)",
  "legend.degraded": "Degraded (0.6–0.9)",
  "legend.broken": "Broken / spy",
  "legend.rescued": "Rescued",
  "legend.cities": "Cities (QPU nodes)",
  "legend.main": "Main network: Bogotá · Medellín · Cali",
  "legend.challenge": "Challenge: Cartagena",

  // --- status --------------------------------------------------------------
  "status.ready": "Ready",
  "status.running": "Running…",
  "status.success": "Done",
  "status.failed": "Failed",
  "status.recorded": "Showing recorded result",
  "status.busy": "A run is already in progress.",

  // --- levels (titles / summaries) ----------------------------------------
  "level.link.title": "First link",
  "level.link.summary": "Bell pair measured in X, Y, Z: F from three correlators.",
  "level.teleport.title": "Teleportation",
  "level.teleport.summary": "Teleport a qubit over a (noisy) link; Pauli frame in Python.",
  "level.noise.title": "Noise is someone listening",
  "level.noise.summary": "Werner noise from environment qubits: measured F vs configured F.",
  "level.swap.title": "Repeater (swapping)",
  "level.swap.summary": "Join two links with a Bell measurement; F = F1 F2 + (1-F1)(1-F2)/3.",
  "level.purify.title": "Distillation",
  "level.purify.summary": "DEJMPS, fixed vs adaptive. Pick one noise channel: gamma, F or p.",
  "level.qkd.title": "Catch the spy",
  "level.qkd.summary": "E91/BBM92 with a spy: QBER, CHSH, key rate.",
  "level.rescue.title": "Save the Quantum Network",
  "level.rescue.summary": "Repair a damaged link: direct, reroute or purify (one job; reduced on narrow backends).",

  // --- parameters ----------------------------------------------------------
  "param.shots": "Shots",
  "param.theta_deg": "Angle θ (°)",
  "param.phi_deg": "Angle φ (°)",
  "param.F": "Fidelity F",
  "param.Fs": "Fidelities F (comma separated, 1–5)",
  "param.F1": "Fidelity F₁ (link 1)",
  "param.F2": "Fidelity F₂ (link 2)",
  "param.gamma": "Damping γ",
  "param.p": "Pauli weights p (I, X, Y, Z; sum 1)",
  "param.strategy": "Strategy",
  "param.mode": "Mode",
  "param.smart_direct": "Smart direct CHSH angles",
  "param.beta_source": "Bias source",
  "param.broken": "Broken link",
  "param.damage_kind": "Damage kind",
  "param.damage_F": "Damage fidelity F",
  "param.damage_gamma": "Damage γ",
  "param.damage_theta_deg": "Spy angle θ (°)",
  "param.healthy_F": "Healthy links F",
  "param.target_F": "Target F",
  "param.channel": "Noise channel",
  "param.channel.gamma": "Amplitude damping (γ)",
  "param.channel.F": "Werner noise (F)",
  "param.channel.p": "Pauli weights (p)",
  "param.qkd_F.use": "Add Werner noise F (only without spy, θ = 0)",
  "param.qkd_F.note": "Only without a spy: set θ = 0 to enable.",
  "param.qkd_F.ionq": "Not available on IonQ.",
  "param.precision_note": "Precision mode only supports Pauli channels (F or p).",

  // --- results -------------------------------------------------------------
  "res.theory": "theory",
  "res.ci": "95% CI",
  "res.backend": "Backend",
  "res.time": "Time",
  "res.shots": "Shots",
  "res.source": "Source",
  "res.source.live": "Live run",
  "res.source.ionq_packed": "IonQ run (one packed circuit)",
  "res.source.recorded": "Recorded run",
  "res.recorded": "Recorded · {backend} · {timestamp}",
  "res.recorded_note": "This is a stored result, not a new run.",
  "res.cached": "Served from this Run's cache (same level, no new job).",
  "res.params_ignored": "New parameters were ignored. Showing the parameters actually used:",
  "res.params": "Parameters used",
  "res.reduced": "Reduced to fit IonQ:",
  "res.notes": "Notes",
  "res.failed": "Failed",
  "res.live_unavailable": "Live run not available",
  "res.error": "Error: {error}",
  "res.error.generic": "The backend returned an error.",
  "res.timeout": "The call timed out after {s} s.",
  "res.no_fallback": "No recorded result is available for this level.",
  "res.link_status": "Link {link}",
  "res.f_value": "F = {F}",
  "err.ionq_job_used": "IonQ runs one level per Run. Press Stop → Run to run this level live.",
  "err.ionq_too_wide": "This level needs {needed} qubits but the backend only has {max}. Nothing was sent.",
  "err.input_error": "Invalid input: check the parameters.",
  "err.previous_pending": "Previous run still finishing…",
  "err.ionq_use_run_level": "This call is not available on IonQ; use the level selector and Run.",

  // --- link states ---------------------------------------------------------
  "state.healthy": "healthy",
  "state.degraded": "degraded",
  "state.broken": "broken",
  "state.damaged": "damaged",
  "state.rescued": "rescued",

  // --- rescue --------------------------------------------------------------
  "rescue.recommendation": "Recommendation",
  "rescue.strategies": "Strategies",
  "rescue.incomplete": "Incomplete: not measured on this backend ({list}). The recommendation covers only the measured strategies.",
  "rescue.status.ok": "measured",
  "rescue.status.no_data": "no data",
  "rescue.status.not_run": "not run",
  "rescue.theory_only": "theory only (not measured)",
  "rescue.fidelity": "Fidelity",
  "rescue.raw_pairs": "Raw pairs",
  "rescue.meets": "Meets target: {v}",
  "rescue.theory_meets": "Theory meets target: {v}",
  "rescue.yes": "yes",
  "rescue.no": "no",
  "rescue.no_data_text": "No data: no shot passed the postselection.",
  "strategy.direct": "Use the damaged link",
  "strategy.reroute": "Reroute via {city}",
  "strategy.purify_fixed": "Purify once (fixed DEJMPS)",
  "strategy.purify_adaptive": "Purify once (adaptive U)",

  // --- cities --------------------------------------------------------------
  "city.main": "Main network node",
  "city.challenge": "Challenge city (outside the main network)",
  "city.coords": "lat {lat}, lon {lon}",

  // --- explainer -----------------------------------------------------------
  "ex.prefix": "What am I seeing?",
  "ex.F": "F = <b>{F}</b>.",
  "ex.link.title": "First link",
  "ex.link.before":
    "We create a <b>Bell pair</b> (two entangled qubits) and measure it in three directions (X, Y, Z). " +
    "If the pair is perfect, both sides give perfectly correlated results: that is why almost every photon is <b>blue</b> (equal). " +
    "The <b>fidelity F</b> says how close the pair is to the ideal one (F = 1).",
  "ex.link.good": "The link is almost perfect.",
  "ex.link.bad": "There is some noise on the link.",
  "ex.teleport.title": "Teleportation",
  "ex.teleport.before":
    "We <b>teleport</b> a qubit state from one side to the other using a Bell pair and two classical bits. " +
    "No matter travels: the <b>information</b> of the state does. A noisy link degrades the teleported copy. " +
    "The classical limit is 2/3: above it, the teleportation is genuinely quantum.",
  "ex.teleport.good": "High-fidelity teleportation.",
  "ex.teleport.bad": "Noise degraded the teleported state.",
  "ex.noise.title": "Noise is someone listening",
  "ex.noise.before":
    "Link noise is modelled as an <b>environment that carries information away</b> (as if someone were listening). " +
    "The more noise, the more photons turn <b>orange</b> (different results). We compare the measured fidelity with the configured one for each F.",
  "ex.noise.after": "Watch the measured fidelity drop as the configured F drops.",
  "ex.swap.title": "Repeater (entanglement swapping)",
  "ex.swap.before":
    "To reach far, we join <b>two links</b> at a middle node with a Bell measurement: the result is an end-to-end link " +
    "(A–C) even though A and C never interacted. The final fidelity combines both hops: F = F₁·F₂ + (1−F₁)(1−F₂)/3.",
  "ex.swap.good": "The repeater keeps good fidelity.",
  "ex.swap.bad": "Joining two links accumulates noise.",
  "ex.purify.title": "Distillation (purification)",
  "ex.purify.before":
    "We take <b>two noisy pairs</b> and, sacrificing one, obtain <b>one better pair</b> (DEJMPS). " +
    "The <b>adaptive</b> version looks at the kind of noise and picks the best local operation: it often beats the fixed one. " +
    "The price: more raw pairs are consumed per good pair.",
  "ex.purify.after": "Fidelity rose from <b>{i}</b> (input) to <b>{a}</b> (adaptive).",
  "ex.purify.generic": "Compare the input fidelity with the purified one.",
  "ex.qkd.title": "Catch the spy (QKD)",
  "ex.qkd.before":
    "Alice and Bob make a <b>secret key</b> by sharing Bell pairs. If a <b>spy (Eve)</b> listens, she introduces errors: " +
    "the <b>QBER</b> goes up and the <b>CHSH</b> value goes down. If CHSH > 2 the entanglement is genuine and the line is safe; if it drops, there is a spy.",
  "ex.qkd.safe": "CHSH = <b>{S}</b> &gt; 2: genuine entanglement, safe line.",
  "ex.qkd.lost": "CHSH = <b>{S}</b> ≤ 2: the quantum correlation is gone (possible spy).",
  "ex.qkd.generic": "Look at the CHSH value: above 2 the line is safe.",
  "ex.rescue.title": "Save the quantum network",
  "ex.rescue.before":
    "A link got <b>damaged</b>. There are three ways to deliver an end-to-end pair: use it <b>directly</b>, " +
    "<b>reroute</b> through the third city, or <b>purify</b>. The app recommends the strategy that reaches the fidelity target " +
    "using the fewest pairs (counting fiber loss).",
  "ex.rescue.generic": "Compare the strategies and their cost.",
};

const ES = {
  "app.title": "Entangle the Andes",
  "app.sub": "Internet cuántico de Colombia · Bogotá · Medellín · Cali",
  "doc.title": "Entangle the Andes · Internet cuántico de Colombia",
  "loader.text": "Tejiendo la red cuántica…",
  "level.label": "Nivel",
  "run": "Ejecutar",
  "results.title": "Resultados",
  "results.empty": "Elige un nivel y pulsa Ejecutar.",
  "results.region": "Resultados",
  "badge.backend": "backend: {name}",
  "badge.partners": "Qollab × IonQ",
  "lang.button": "English",
  "lang.aria": "Switch language to English (cambiar a inglés)",
  "footer.attribution": "This effort is supported by Qollab & IonQ.",
  "cities.title": "Ciudades (nodos QPU)",
  "cities.aria": "Ciudades de la red",
  "cities.hint": "Selecciona una ciudad para ver sus detalles.",
  "params.title": "Parámetros",
  "controls.region": "Controles",
  "scene.aria": "Mapa 3D de Colombia con los enlaces de la red cuántica",
  "geo.colombia": "COLOMBIA", "geo.panama": "PANAMÁ", "geo.venezuela": "VENEZUELA", "geo.ecuador": "ECUADOR",
  "geo.peru": "PERÚ", "geo.brazil": "BRASIL",
  "geo.caribbean": "Mar Caribe", "geo.pacific": "Océano Pacífico",
  "geo.cord_w": "Cordillera Occidental", "geo.cord_c": "Cordillera Central", "geo.cord_e": "Cordillera Oriental",
  "geo.llanos": "Llanos", "geo.amazon": "Amazonía",
  "link.idle": "sin medir", "link.healthy": "sano", "link.degraded": "degradado", "link.broken": "roto",
  "link.rescued": "rescatado",
  "link.km": "{km} km círculo máximo",
  "tip.link.gc": "Distancia de círculo máximo: {km} km",
  "tip.link.fibre": "Ruta de fibra supuesta: {km} km (x1,3, no medida)",
  "tip.link.eta": "Supervivencia de un fotón: {eta}",
  "tip.link.f": "Último resultado: F = {F} ({status})",
  "footer.mapdata": "Datos del mapa: NASA Blue Marble · Terrain Tiles (Mapzen/AWS)",

  "legend.toggle": "Leyenda",
  "legend.photons": "Fotones (pares de Bell)",
  "legend.p0": "Azul/cian: resultado <b>igual</b> (paridad 0): correlación sana",
  "legend.p1": "Naranja: resultado <b>distinto</b> (paridad 1): error / ruido / espía",
  "legend.fiber": "Enlaces de fibra",
  "legend.healthy": "Sano (F ≥ 0.9)",
  "legend.degraded": "Degradado (0.6–0.9)",
  "legend.broken": "Roto / espía",
  "legend.rescued": "Rescatado",
  "legend.cities": "Ciudades (nodos QPU)",
  "legend.main": "Red principal: Bogotá · Medellín · Cali",
  "legend.challenge": "Reto: Cartagena",

  "status.ready": "Listo",
  "status.running": "Ejecutando…",
  "status.success": "Terminado",
  "status.failed": "Falló",
  "status.recorded": "Mostrando resultado grabado",
  "status.busy": "Ya hay una ejecución en curso.",

  "level.link.title": "Primer enlace",
  "level.link.summary": "Par de Bell medido en X, Y, Z: F a partir de tres correladores.",
  "level.teleport.title": "Teletransporte",
  "level.teleport.summary": "Teletransporta un qubit por un enlace (ruidoso); marco de Pauli en Python.",
  "level.noise.title": "El ruido es alguien escuchando",
  "level.noise.summary": "Ruido de Werner desde qubits de entorno: F medida vs F configurada.",
  "level.swap.title": "Repetidor (swapping)",
  "level.swap.summary": "Une dos enlaces con una medida de Bell; F = F1 F2 + (1-F1)(1-F2)/3.",
  "level.purify.title": "Destilación",
  "level.purify.summary": "DEJMPS, fija vs adaptativa. Elige un canal de ruido: gamma, F o p.",
  "level.qkd.title": "Atrapa al espía",
  "level.qkd.summary": "E91/BBM92 con espía: QBER, CHSH, tasa de clave.",
  "level.rescue.title": "Salva la red cuántica",
  "level.rescue.summary": "Repara un enlace dañado: directo, reenrutar o purificar (un trabajo; reducido en backends estrechos).",

  "param.shots": "Disparos (shots)",
  "param.theta_deg": "Ángulo θ (°)",
  "param.phi_deg": "Ángulo φ (°)",
  "param.F": "Fidelidad F",
  "param.Fs": "Fidelidades F (separadas por comas, 1–5)",
  "param.F1": "Fidelidad F₁ (enlace 1)",
  "param.F2": "Fidelidad F₂ (enlace 2)",
  "param.gamma": "Amortiguamiento γ",
  "param.p": "Pesos de Pauli p (I, X, Y, Z; suma 1)",
  "param.strategy": "Estrategia",
  "param.mode": "Modo",
  "param.smart_direct": "Ángulos CHSH directos inteligentes",
  "param.beta_source": "Fuente del sesgo",
  "param.broken": "Enlace roto",
  "param.damage_kind": "Tipo de daño",
  "param.damage_F": "Fidelidad del daño F",
  "param.damage_gamma": "Daño γ",
  "param.damage_theta_deg": "Ángulo del espía θ (°)",
  "param.healthy_F": "F de los enlaces sanos",
  "param.target_F": "F objetivo",
  "param.channel": "Canal de ruido",
  "param.channel.gamma": "Amortiguamiento de amplitud (γ)",
  "param.channel.F": "Ruido de Werner (F)",
  "param.channel.p": "Pesos de Pauli (p)",
  "param.qkd_F.use": "Añadir ruido de Werner F (solo sin espía, θ = 0)",
  "param.qkd_F.note": "Solo sin espía: pon θ = 0 para activarlo.",
  "param.qkd_F.ionq": "No disponible en IonQ.",
  "param.precision_note": "El modo precision solo admite canales de Pauli (F o p).",

  "res.theory": "teoría",
  "res.ci": "IC 95 %",
  "res.backend": "Backend",
  "res.time": "Fecha",
  "res.shots": "Disparos",
  "res.source": "Origen",
  "res.source.live": "Ejecución en vivo",
  "res.source.ionq_packed": "Ejecución IonQ (un circuito empaquetado)",
  "res.source.recorded": "Ejecución grabada",
  "res.recorded": "Grabado · {backend} · {timestamp}",
  "res.recorded_note": "Es un resultado almacenado, no una ejecución nueva.",
  "res.cached": "Servido desde la caché de este Run (mismo nivel, sin trabajo nuevo).",
  "res.params_ignored": "Los parámetros nuevos se ignoraron. Se muestran los parámetros realmente usados:",
  "res.params": "Parámetros usados",
  "res.reduced": "Reducido para caber en IonQ:",
  "res.notes": "Notas",
  "res.failed": "Falló",
  "res.live_unavailable": "Ejecución en vivo no disponible",
  "res.error": "Error: {error}",
  "res.error.generic": "El backend devolvió un error.",
  "res.timeout": "La llamada superó el tiempo límite ({s} s).",
  "res.no_fallback": "No hay un resultado grabado para este nivel.",
  "res.link_status": "Enlace {link}",
  "res.f_value": "F = {F}",
  "err.ionq_job_used": "IonQ ejecuta un nivel por Run. Pulsa Stop → Run para ejecutar este nivel en vivo.",
  "err.ionq_too_wide": "Este nivel necesita {needed} qubits y el backend solo tiene {max}. No se envió nada.",
  "err.input_error": "Entrada no válida: revisa los parámetros.",
  "err.previous_pending": "La ejecución anterior aún está terminando…",
  "err.ionq_use_run_level": "Esta llamada no está disponible en IonQ; usa el selector de nivel y Ejecutar.",

  "state.healthy": "sano",
  "state.degraded": "degradado",
  "state.broken": "roto",
  "state.damaged": "dañado",
  "state.rescued": "rescatado",

  "rescue.recommendation": "Recomendación",
  "rescue.strategies": "Estrategias",
  "rescue.incomplete": "Incompleto: no medido en este backend ({list}). La recomendación solo cubre las estrategias medidas.",
  "rescue.status.ok": "medida",
  "rescue.status.no_data": "sin datos",
  "rescue.status.not_run": "no ejecutada",
  "rescue.theory_only": "solo teoría (no medido)",
  "rescue.fidelity": "Fidelidad",
  "rescue.raw_pairs": "Pares crudos",
  "rescue.meets": "Cumple el objetivo: {v}",
  "rescue.theory_meets": "La teoría cumple el objetivo: {v}",
  "rescue.yes": "sí",
  "rescue.no": "no",
  "rescue.no_data_text": "Sin datos: ningún disparo pasó la postselección.",
  "strategy.direct": "Usar el enlace dañado",
  "strategy.reroute": "Reenrutar vía {city}",
  "strategy.purify_fixed": "Purificar una vez (DEJMPS fija)",
  "strategy.purify_adaptive": "Purificar una vez (U adaptativa)",

  "city.main": "Nodo de la red principal",
  "city.challenge": "Ciudad reto (fuera de la red principal)",
  "city.coords": "lat {lat}, lon {lon}",

  "ex.prefix": "¿Qué estoy viendo?",
  "ex.F": "F = <b>{F}</b>.",
  "ex.link.title": "Primer enlace",
  "ex.link.before":
    "Creamos un <b>par de Bell</b> (dos qubits entrelazados) y lo medimos en tres direcciones (X, Y, Z). " +
    "Si el par es perfecto, los dos lados dan resultados perfectamente correlacionados: por eso casi todos los fotones salen <b>azules</b> (iguales). " +
    "La <b>fidelidad F</b> mide qué tan cerca está del par ideal (F = 1).",
  "ex.link.good": "El enlace es casi perfecto.",
  "ex.link.bad": "Hay algo de ruido en el enlace.",
  "ex.teleport.title": "Teletransporte",
  "ex.teleport.before":
    "<b>Teletransportamos</b> el estado de un qubit de un lado al otro usando un par de Bell y dos bits clásicos. " +
    "No viaja materia: viaja la <b>información</b> del estado. Un enlace ruidoso degrada la copia teletransportada. " +
    "El límite clásico es 2/3: por encima de eso, el teletransporte es genuinamente cuántico.",
  "ex.teleport.good": "Teletransporte de alta fidelidad.",
  "ex.teleport.bad": "El ruido degradó el estado teletransportado.",
  "ex.noise.title": "El ruido es alguien escuchando",
  "ex.noise.before":
    "El ruido de un enlace se modela como un <b>entorno que se lleva información</b> (como si alguien escuchara). " +
    "Cuanto más ruido, más fotones salen <b>naranjas</b> (resultados distintos). Comparamos la fidelidad medida con la configurada para cada F.",
  "ex.noise.after": "Mira cómo baja la fidelidad medida a medida que baja la F configurada.",
  "ex.swap.title": "Repetidor (entanglement swapping)",
  "ex.swap.before":
    "Para llegar lejos, unimos <b>dos enlaces</b> en un nodo intermedio con una medida de Bell: el resultado es un enlace extremo a extremo " +
    "(A–C) aunque A y C nunca interactuaron. La fidelidad final combina las de los dos tramos: F = F₁·F₂ + (1−F₁)(1−F₂)/3.",
  "ex.swap.good": "El repetidor mantiene buena fidelidad.",
  "ex.swap.bad": "Unir dos enlaces acumula ruido.",
  "ex.purify.title": "Destilación (purificación)",
  "ex.purify.before":
    "Tomamos <b>dos pares ruidosos</b> y, sacrificando uno, obtenemos <b>un par mejor</b> (DEJMPS). " +
    "La versión <b>adaptativa</b> mira el tipo de ruido y elige la mejor operación local: suele ganar sobre la fija. " +
    "El precio: se consumen más pares crudos por cada par bueno.",
  "ex.purify.after": "La fidelidad subió de <b>{i}</b> (entrada) a <b>{a}</b> (adaptativa).",
  "ex.purify.generic": "Compara la fidelidad de entrada con la purificada.",
  "ex.qkd.title": "Atrapa al espía (QKD)",
  "ex.qkd.before":
    "Alice y Bob generan una <b>clave secreta</b> compartiendo pares de Bell. Si un <b>espía (Eve)</b> escucha, introduce errores: " +
    "sube el <b>QBER</b> y baja el valor <b>CHSH</b>. Si CHSH > 2, hay entrelazamiento genuino y la línea es segura; si baja, hay espía.",
  "ex.qkd.safe": "CHSH = <b>{S}</b> &gt; 2: entrelazamiento genuino, línea segura.",
  "ex.qkd.lost": "CHSH = <b>{S}</b> ≤ 2: la correlación cuántica se perdió (posible espía).",
  "ex.qkd.generic": "Mira el valor CHSH: por encima de 2 la línea es segura.",
  "ex.rescue.title": "Salva la red cuántica",
  "ex.rescue.before":
    "Un enlace quedó <b>dañado</b>. Hay tres formas de entregar un par extremo a extremo: usarlo <b>directo</b>, " +
    "<b>reenrutar</b> por la tercera ciudad, o <b>purificar</b>. La app recomienda la estrategia que alcanza el objetivo de fidelidad " +
    "gastando menos pares (contando la pérdida de la fibra).",
  "ex.rescue.generic": "Compara las estrategias y su costo.",
};

const DICTS = { en: EN, es: ES };
let lang = "en";
const listeners = [];

export const getLang = () => lang;
export const dictionaries = DICTS;

export function t(key, vars) {
  let s = DICTS[lang][key] ?? EN[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

// Like t() but falls back to `fallback` when the key does not exist.
export function tOr(key, fallback, vars) {
  return key in EN || key in DICTS[lang] ? t(key, vars) : fallback;
}

export function onLangChange(cb) {
  listeners.push(cb);
}

export function setLang(next) {
  if (!DICTS[next] || next === lang) return;
  lang = next;
  document.documentElement.lang = next;
  applyI18n(document);
  for (const cb of listeners) cb(next);
}

export function applyI18n(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll("[data-i18n-title]")) el.setAttribute("title", t(el.dataset.i18nTitle));
  document.title = t("doc.title");
}
