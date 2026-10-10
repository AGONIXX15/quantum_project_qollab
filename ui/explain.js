/*
  Textos explicativos de la UI (lenguaje simple, en español).

  Un sitio central para la "capa educativa": qué significa cada nivel, qué
  representan las bolas y los colores, y qué mirar en el resultado. Se usa en el
  panel "¿Qué estoy viendo?" y en los tooltips.
*/

// Explicación por nivel. {before} se muestra antes de ejecutar; {after(result)}
// genera una línea con la lectura del resultado ya ejecutado.
export const LEVEL_EXPLAIN = {
  link: {
    title: "Primer enlace",
    before:
      "Creamos un <b>par de Bell</b> (dos qubits entrelazados) y lo medimos en tres direcciones (X, Y, Z). " +
      "Si el par es perfecto, los dos lados dan resultados perfectamente correlacionados: por eso casi todos los fotones salen <b>azules</b> (iguales). " +
      "La <b>fidelidad F</b> mide qué tan cerca está del par ideal (F = 1).",
    after: (r) => fidelityLine(r, "El enlace es casi perfecto.", "Hay algo de ruido en el enlace."),
  },
  teleport: {
    title: "Teletransporte",
    before:
      "<b>Teletransportamos</b> el estado de un qubit de un lado al otro usando un par de Bell y dos bits clásicos. " +
      "No viaja materia: viaja la <b>información</b> del estado. Un enlace ruidoso degrada la copia teletransportada. " +
      "El límite clásico es 2/3: por encima de eso, el teletransporte es genuinamente cuántico.",
    after: (r) => fidelityLine(r, "Teletransporte de alta fidelidad.", "El ruido degradó el estado teletransportado."),
  },
  noise: {
    title: "El ruido es alguien escuchando",
    before:
      "El ruido de un enlace se modela como un <b>entorno que se lleva información</b> (como si alguien escuchara). " +
      "Cuanto más ruido, más fotones salen <b>naranjas</b> (resultados distintos). Comparamos la fidelidad medida con la configurada para cada F.",
    after: () => "Mira cómo baja la fidelidad medida a medida que baja la F configurada.",
  },
  swap: {
    title: "Repetidor (entanglement swapping)",
    before:
      "Para llegar lejos, unimos <b>dos enlaces</b> en un nodo intermedio con una medida de Bell: el resultado es un enlace extremo a extremo " +
      "(A–C) aunque A y C nunca interactuaron. La fidelidad final combina las de los dos tramos: F = F₁·F₂ + (1−F₁)(1−F₂)/3.",
    after: (r) => fidelityLine(r, "El repetidor mantiene buena fidelidad.", "Unir dos enlaces acumula ruido."),
  },
  purify: {
    title: "Destilación (purificación)",
    before:
      "Tomamos <b>dos pares ruidosos</b> y, sacrificando uno, obtenemos <b>un par mejor</b> (DEJMPS). " +
      "La versión <b>adaptativa</b> mira el tipo de ruido y elige la mejor operación local: suele ganar sobre la fija. " +
      "El precio: se consumen más pares crudos por cada par bueno.",
    after: (r) => {
      const a = r?.metrics?.fidelity_adaptive?.value;
      const i = r?.metrics?.fidelity_input?.value;
      if (a != null && i != null)
        return `La fidelidad subió de <b>${i.toFixed(3)}</b> (entrada) a <b>${a.toFixed(3)}</b> (adaptativa).`;
      return "Compara la fidelidad de entrada con la purificada.";
    },
  },
  qkd: {
    title: "Atrapa al espía (QKD)",
    before:
      "Alice y Bob generan una <b>clave secreta</b> compartiendo pares de Bell. Si un <b>espía (Eve)</b> escucha, introduce errores: " +
      "sube el <b>QBER</b> y baja el valor <b>CHSH</b>. Si CHSH > 2, hay entrelazamiento genuino y la línea es segura; si baja, hay espía.",
    after: (r) => {
      const s = r?.metrics?.chsh_standard?.value;
      if (s != null)
        return s > 2
          ? `CHSH = <b>${s.toFixed(2)}</b> &gt; 2: entrelazamiento genuino, línea segura.`
          : `CHSH = <b>${s.toFixed(2)}</b> ≤ 2: la correlación cuántica se perdió (posible espía).`;
      return "Mira el valor CHSH: por encima de 2 la línea es segura.";
    },
  },
  rescue: {
    title: "Salva la red cuántica",
    before:
      "Un enlace quedó <b>dañado</b>. Hay tres formas de entregar un par extremo a extremo: usarlo <b>directo</b>, " +
      "<b>reenrutar</b> por la tercera ciudad, o <b>purificar</b>. La app recomienda la estrategia que alcanza el objetivo de fidelidad " +
      "gastando menos pares (contando la pérdida de la fibra).",
    after: (r) => {
      const rec = r?.viz?.recommendation;
      return rec?.message ? `<b>${rec.message}</b>` : "Compara las tres estrategias y su costo.";
    },
  },
};

function fidelityLine(r, good, bad) {
  const F = r?.metrics?.fidelity?.value;
  if (F == null) return "";
  return F >= 0.9 ? `F = <b>${F.toFixed(3)}</b>. ${good}` : `F = <b>${F.toFixed(3)}</b>. ${bad}`;
}

// Tooltip de una ciudad (nodo QPU).
export function cityTooltip(data) {
  const role = data.challenge ? "Ciudad reto (fuera de la red principal)" : "Nodo de la red principal";
  return {
    title: data.name,
    rows: [role, `lat ${data.lat.toFixed(3)}, lon ${data.lon.toFixed(3)}`],
  };
}
