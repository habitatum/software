// 077 · Soporte de personal por administración en los cortes de obra.
// Registro día a día (nombre opcional · cargo · día · horas). El total de horas de cada cargo es la cantidad
// del ítem del contrato asociado a ese cargo (contrato_personal_cargos); si dos cargos van al mismo ítem, se suman.

export const CARGOS_PERSONAL = [
  { id: 'OFICIAL_HO', nombre: 'Oficial H.O', largo: 'Oficial · horas ordinarias' },
  { id: 'AYUDANTE_HO', nombre: 'Ayudante H.O', largo: 'Ayudante · horas ordinarias' },
  { id: 'OFICIAL_HED', nombre: 'Oficial H.E.D', largo: 'Oficial · horas extra diurnas' },
  { id: 'AYUDANTE_HED', nombre: 'Ayudante H.E.D', largo: 'Ayudante · horas extra diurnas' },
  { id: 'OFICIAL_HEN', nombre: 'Oficial H.E.N', largo: 'Oficial · horas extra nocturnas' },
  { id: 'AYUDANTE_HEN', nombre: 'Ayudante H.E.N', largo: 'Ayudante · horas extra nocturnas' },
];
export const nombreCargo = (id) => CARGOS_PERSONAL.find((c) => c.id === id)?.nombre || id;

const n = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? 0 : Number(v));
const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Sugerencia del ítem del contrato para cada cargo según su descripción (p. ej. "Hora Ordinaria Oficial").
export function sugerirItemCargo(cargo, items) {
  const [rol, tipo] = cargo.split('_');
  const quiere = (d) => {
    const t = norm(d);
    const esRol = rol === 'OFICIAL' ? /oficial/.test(t) && !/ayudante/.test(t) : /ayudante/.test(t);
    if (!esRol) return false;
    const extra = /extra|h\.?\s?e\.?\s?[dn]\b/.test(t);
    if (tipo === 'HO') return !extra;
    if (tipo === 'HED') return extra && /diurn|h\.?\s?e\.?\s?d\b/.test(t);
    return extra && /noctur|h\.?\s?e\.?\s?n\b/.test(t);
  };
  const cand = (items || []).filter((i) => quiere(`${i.descripcion} ${i.codigo || ''}`));
  // Preferir ítems por hora y, entre ellos, el primero del contrato.
  cand.sort((a, b) => (/hora|^h/i.test(norm(b.unidad)) - /hora|^h/i.test(norm(a.unidad))) || (n(a.orden) - n(b.orden)));
  return cand[0]?.id || '';
}

// Totales de horas por cargo y por ítem del contrato.
export function totalesPersonal(filas, mapeo) {
  const porCargo = Object.fromEntries(CARGOS_PERSONAL.map((c) => [c.id, 0]));
  (filas || []).forEach((f) => { if (porCargo[f.cargo] !== undefined) porCargo[f.cargo] += n(f.horas); });
  const porItem = {};
  Object.entries(porCargo).forEach(([cargo, h]) => {
    const it = mapeo?.[cargo];
    if (it && (h > 0 || porItem[it] === undefined)) porItem[it] = Math.round(((porItem[it] || 0) + h) * 100) / 100;
  });
  const total = Object.values(porCargo).reduce((a, h) => a + h, 0);
  return { porCargo, porItem, total: Math.round(total * 100) / 100 };
}
