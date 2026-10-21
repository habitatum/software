import { renderToBuffer } from '@react-pdf/renderer';
import PlantillaReciboCajaMenorPDF from './PlantillaReciboCajaMenorPDF';

// Genera el PDF del recibo de caja menor (065), lo guarda en `soportes-oc` y lo deja como soporte del gasto.
// - lectura: cliente con el que se leen los datos (service role desde el bot, o el token del admin desde la App;
//   datos_recibo_caja_menor exige admin cuando hay usuario).
// - servicio: cliente service role para escribir en Storage y en el gasto.
// No pisa un soporte real del proveedor: solo escribe si el gasto no tiene soporte o si el que tiene es un recibo.
export async function generarReciboCajaMenor({ lectura, servicio, gastoId }) {
  const { data: r, error } = await lectura.rpc('datos_recibo_caja_menor', { p_gasto: gastoId });
  if (error) throw error;
  if (!r) throw new Error('Gasto de caja menor no encontrado.');
  if (!r.recibo_folio) throw new Error('El gasto no tiene número de recibo.');
  const buffer = await renderToBuffer(PlantillaReciboCajaMenorPDF({ r }));
  const ruta = `${r.proyecto_id}/recibos/${r.recibo_folio}.pdf`;
  const { error: errUp } = await servicio.storage.from('soportes-oc').upload(ruta, buffer, { contentType: 'application/pdf', upsert: true });
  if (errUp) throw errUp;
  const { data: g } = await servicio.from('caja_menor_gastos').select('soporte_path').eq('id', gastoId).single();
  if (g?.soporte_path && !g.soporte_path.includes('/recibos/')) return { ruta: g.soporte_path, folio: r.recibo_folio, omitido: true };
  const { error: errUpd } = await servicio.from('caja_menor_gastos').update({ soporte_path: ruta }).eq('id', gastoId);
  if (errUpd) throw errUpd;
  return { ruta, folio: r.recibo_folio };
}
