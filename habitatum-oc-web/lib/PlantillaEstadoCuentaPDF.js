import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { formatoPesos } from './calculosOC';
import { EncabezadoPDF, COLOR_DORADO, COLOR_FONDO } from './EncabezadoPDF';

// ============================================================
// Estado de cuenta de un Contrato.
// Los datos vienen completos de la función SQL estado_cuenta_contrato(uuid)
// (una sola fuente de verdad: usa v_ordenes_compra_calculadas por debajo).
// Paleta de marca: carbón #2e2e2e, dorado #b88a52, hueso #efece6, gris cálido #cdc5ba.
// ============================================================

const HUESO = '#efece6';
const HUESO_CLARO = '#f7f5f1';
const GRIS_CALIDO = '#cdc5ba';
const TEXTO = '#2e2e2e';
const TEXTO_SUAVE = '#6b655d';
const ROJO = '#9b2c2c';

const estilos = StyleSheet.create({
  pagina: { paddingTop: 30, paddingHorizontal: 30, paddingBottom: 48, fontSize: 8.5, fontFamily: 'Helvetica', color: TEXTO },

  tituloFila: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 },
  titulo: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: TEXTO },
  subtitulo: { fontSize: 9, color: TEXTO_SUAVE, marginTop: 2 },
  corte: { fontSize: 8.5, color: TEXTO_SUAVE, textAlign: 'right' },
  corteFecha: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: COLOR_DORADO, textAlign: 'right' },

  dosColumnas: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  bloque: { flex: 1, borderWidth: 0.5, borderColor: GRIS_CALIDO, borderRadius: 3 },
  bloqueTitulo: { backgroundColor: HUESO, paddingVertical: 4, paddingHorizontal: 6, fontFamily: 'Helvetica-Bold', fontSize: 8.5, color: TEXTO, borderBottomWidth: 1, borderBottomColor: COLOR_DORADO },
  filaDato: { flexDirection: 'row', paddingVertical: 2.5, paddingHorizontal: 6 },
  etiqueta: { width: '38%', color: TEXTO_SUAVE },
  valor: { width: '62%' },

  tarjetas: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  tarjeta: { flex: 1, backgroundColor: HUESO_CLARO, borderTopWidth: 2, borderTopColor: COLOR_DORADO, paddingVertical: 6, paddingHorizontal: 7 },
  tarjetaOscura: { flex: 1, backgroundColor: COLOR_FONDO, borderTopWidth: 2, borderTopColor: COLOR_DORADO, paddingVertical: 6, paddingHorizontal: 7 },
  tarjetaEtiqueta: { fontSize: 7, color: TEXTO_SUAVE, textTransform: 'uppercase', letterSpacing: 0.4 },
  tarjetaEtiquetaClara: { fontSize: 7, color: GRIS_CALIDO, textTransform: 'uppercase', letterSpacing: 0.4 },
  tarjetaValor: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 3, color: TEXTO },
  tarjetaValorClaro: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 3, color: 'white' },
  tarjetaNota: { fontSize: 6.5, color: TEXTO_SUAVE, marginTop: 2 },

  avance: { marginBottom: 12 },
  avanceTexto: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3, fontSize: 7.5, color: TEXTO_SUAVE },
  barraFondo: { height: 6, backgroundColor: HUESO, borderRadius: 3 },
  barra: { height: 6, backgroundColor: COLOR_DORADO, borderRadius: 3 },
  barraExceso: { height: 6, backgroundColor: ROJO, borderRadius: 3 },

  seccion: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: TEXTO, marginTop: 4, marginBottom: 5, paddingBottom: 2, borderBottomWidth: 1, borderBottomColor: COLOR_DORADO },

  tabla: { marginBottom: 10 },
  tEnc: { flexDirection: 'row', backgroundColor: COLOR_FONDO, color: 'white', paddingVertical: 4, paddingHorizontal: 3, fontFamily: 'Helvetica-Bold', fontSize: 7 },
  tFila: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 3, borderBottomWidth: 0.5, borderBottomColor: HUESO },
  tFilaAlt: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 3, borderBottomWidth: 0.5, borderBottomColor: HUESO, backgroundColor: HUESO_CLARO },
  tTotal: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 3, backgroundColor: HUESO, fontFamily: 'Helvetica-Bold', borderTopWidth: 1, borderTopColor: COLOR_DORADO },
  cFolio: { width: '11%' }, cFecha: { width: '9%' }, cConcepto: { width: '22%', paddingRight: 4 },
  cNum: { width: '11.6%', textAlign: 'right' },
  folio: { fontFamily: 'Helvetica-Bold' },
  etiquetaAnticipo: { fontSize: 6, color: COLOR_DORADO, fontFamily: 'Helvetica-Bold' },

  saldos: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  saldoFila: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: HUESO },
  saldoFilaDestacada: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, paddingHorizontal: 6, backgroundColor: HUESO, fontFamily: 'Helvetica-Bold' },

  observacion: { flexDirection: 'row', marginBottom: 3.5 },
  vineta: { width: 8, color: COLOR_DORADO, fontFamily: 'Helvetica-Bold' },
  observacionTexto: { flex: 1, lineHeight: 1.35 },
  sinObservaciones: { color: TEXTO_SUAVE, fontStyle: 'italic' },

  declaracion: { marginTop: 10, fontSize: 7.5, color: TEXTO_SUAVE, lineHeight: 1.4, textAlign: 'justify' },
  firmas: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 34 },
  firma: { width: '44%' },
  rayaFirma: { borderTopWidth: 0.5, borderTopColor: TEXTO, paddingTop: 4, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  firmaDetalle: { fontSize: 7.5, color: TEXTO_SUAVE, marginTop: 1 },

  pie: { position: 'absolute', bottom: 20, left: 30, right: 30, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: TEXTO_SUAVE, borderTopWidth: 0.5, borderTopColor: GRIS_CALIDO, paddingTop: 5 },
});

function fecha(f) {
  if (!f) return '-';
  const p = String(f).slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(f);
}

function fechaColombia(iso) {
  const d = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

function horaColombia(iso) {
  const d = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

// Pesos sin decimales; guion cuando el valor es cero (tablas más limpias).
function pesos(v, { guion = false } = {}) {
  const n = Math.round(Number(v) || 0);
  if (guion && n === 0) return '—';
  return formatoPesos(n);
}

function conceptoMovimiento(m) {
  // Primera frase de las notas (ej. "Corte final", "Abono para Closets y Linos"); si no hay, la descripción.
  const base = (m.notas || '').split('\n')[0].split('. ')[0].trim();
  return base || m.descripcion || (m.tipo_pago === 'ANTICIPO' ? 'Anticipo' : '-');
}

function textoAlertas(d) {
  const { alertas = [], saldos = {}, contrato = {}, totales = {} } = d;
  const s = saldos;
  const lista = [];
  for (const a of alertas) {
    switch (a) {
      case 'SOBREEJECUCION':
        lista.push(`La ejecución supera el valor del contrato en ${pesos(s.sobre_ejecucion)}. Se debe formalizar un otrosí que soporte el mayor valor.`);
        break;
      case 'PLAZO_VENCIDO_CON_SALDO':
        lista.push(`El plazo contractual venció el ${fecha(contrato.fecha_fin)} y quedan ${pesos(s.por_ejecutar)} por ejecutar. Se recomienda formalizar prórroga o liquidar.`);
        break;
      case 'EJECUCION_POSTERIOR_AL_PLAZO':
        lista.push(`La última orden de compra (${fecha(totales.ultima_oc)}) es posterior al vencimiento del plazo (${fecha(contrato.fecha_fin)}). Verificar que exista prórroga escrita o dejar constancia en el acta de recibo.`);
        break;
      case 'SIN_GARANTIA':
        lista.push(Number(s.retenido_por_devolver) > 0
          ? `El contrato no tiene período de garantía pactado: el retenido de ${pesos(s.retenido_por_devolver)} es la única garantía sobre lo ejecutado.`
          : 'El contrato no tiene período de garantía pactado.');
        break;
      case 'ANTICIPO_PENDIENTE':
        lista.push(`Queda un anticipo de ${pesos(s.anticipo_por_amortizar)} pendiente por amortizar en los próximos cortes.`);
        break;
      case 'RETENIDO_PENDIENTE_DEVOLUCION':
        lista.push(Number(s.por_ejecutar) > 0
          ? `Retenido acumulado de ${pesos(s.retenido_por_devolver)}, a devolver en la liquidación del contrato.`
          : `Retenido de ${pesos(s.retenido_por_devolver)} pendiente de devolución, sujeto a acta de recibo a satisfacción.`);
        break;
      default:
        break;
    }
  }
  return lista;
}

function Dato({ etiqueta, valor }) {
  return (
    <View style={estilos.filaDato}>
      <Text style={estilos.etiqueta}>{etiqueta}</Text>
      <Text style={estilos.valor}>{valor === null || valor === undefined || valor === '' ? '-' : String(valor)}</Text>
    </View>
  );
}

function Tarjeta({ etiqueta, valor, nota, oscura }) {
  return (
    <View style={oscura ? estilos.tarjetaOscura : estilos.tarjeta}>
      <Text style={oscura ? estilos.tarjetaEtiquetaClara : estilos.tarjetaEtiqueta}>{etiqueta}</Text>
      <Text style={oscura ? estilos.tarjetaValorClaro : estilos.tarjetaValor}>{valor}</Text>
      {nota ? <Text style={[estilos.tarjetaNota, oscura ? { color: GRIS_CALIDO } : null]}>{nota}</Text> : null}
    </View>
  );
}

export default function PlantillaEstadoCuentaPDF({ datos }) {
  const { contrato = {}, proyecto = {}, contratista = {}, movimientos = [], totales = {}, saldos = {}, generado_en } = datos || {};
  const mostrarHabitatum = proyecto.marca_habitatum !== false;
  const nombreContratante = mostrarHabitatum ? 'HABITATUM S.A.S.' : (proyecto.emisor || proyecto.cliente || 'Contratante');
  const pct = Number(saldos.porcentaje_ejecucion) || 0;
  const observaciones = textoAlertas(datos || {});
  const cuenta = [contratista.banco, contratista.tipo_cuenta, contratista.numero_cuenta].filter(Boolean).join(' · ');
  const plazo = contrato.plazo_valor ? `${contrato.plazo_valor} ${contrato.plazo_unidad || ''}`.trim() : '-';
  const garantia = contrato.garantia_meses && contrato.garantia_meses !== '0' ? `${contrato.garantia_meses} meses` : 'No pactada';

  return (
    <Document title={`Estado de cuenta ${contrato.numero || ''}`} author={nombreContratante}>
      <Page size="A4" style={estilos.pagina}>
        <EncabezadoPDF
          tituloDocumento={`Estado de cuenta · Contrato ${contrato.numero || ''}`}
          nombreObra={proyecto.nombre}
          mostrarMarcaHabitatum={mostrarHabitatum}
          nombreEmisor={proyecto.emisor}
        />

        <View style={estilos.tituloFila}>
          <View>
            <Text style={estilos.titulo}>Estado de cuenta del contrato</Text>
            <Text style={estilos.subtitulo}>{contrato.concepto}{contrato.estado && contrato.estado !== 'VIGENTE' ? ` · ${contrato.estado}` : ''}</Text>
          </View>
          <View>
            <Text style={estilos.corte}>Corte al</Text>
            <Text style={estilos.corteFecha}>{fechaColombia(generado_en)}</Text>
          </View>
        </View>

        <View style={estilos.dosColumnas}>
          <View style={estilos.bloque}>
            <Text style={estilos.bloqueTitulo}>Contratista</Text>
            <Dato etiqueta="Nombre" valor={contratista.nombre} />
            <Dato etiqueta="NIT / C.C." valor={contratista.nit} />
            <Dato etiqueta="Cuenta" valor={cuenta} />
            <Dato etiqueta="Teléfono" valor={contratista.telefono} />
          </View>
          <View style={estilos.bloque}>
            <Text style={estilos.bloqueTitulo}>Contrato</Text>
            <Dato etiqueta="Objeto" valor={contrato.alcance && contrato.alcance.length <= 90 ? contrato.alcance : contrato.concepto} />
            <Dato etiqueta="Fecha / inicio" valor={`${fecha(contrato.fecha_contrato)} / ${fecha(contrato.fecha_inicio)}`} />
            <Dato etiqueta="Plazo" valor={contrato.fecha_fin ? `${plazo} (vence ${fecha(contrato.fecha_fin)})` : plazo} />
            <Dato etiqueta="Garantía" valor={garantia} />
          </View>
        </View>

        <View style={estilos.tarjetas}>
          <Tarjeta etiqueta="Valor del contrato" valor={pesos(contrato.valor)} oscura />
          <Tarjeta etiqueta="Ejecutado" valor={pesos(totales.ejecutado)} nota={`${pct.toLocaleString('es-CO', { maximumFractionDigits: 1 })}% del contrato`} />
          <Tarjeta etiqueta="Girado neto" valor={pesos(saldos.girado_neto)} nota={`${totales.n_ocs || 0} órdenes de compra`} />
          <Tarjeta etiqueta="Anticipo pendiente" valor={pesos(saldos.anticipo_por_amortizar)} nota="por amortizar" />
          <Tarjeta etiqueta="Retenido" valor={pesos(saldos.retenido_por_devolver)} nota="por devolver" />
        </View>

        <View style={estilos.avance}>
          <View style={estilos.avanceTexto}>
            <Text>Avance de ejecución</Text>
            <Text>{pct.toLocaleString('es-CO', { maximumFractionDigits: 1 })}%{Number(saldos.sobre_ejecucion) > 0 ? ` · sobreejecución ${pesos(saldos.sobre_ejecucion)}` : ''}</Text>
          </View>
          <View style={estilos.barraFondo}>
            <View style={[pct > 100 ? estilos.barraExceso : estilos.barra, { width: `${Math.min(pct, 100)}%` }]} />
          </View>
        </View>

        <Text style={estilos.seccion}>Movimientos</Text>
        <View style={estilos.tabla}>
          <View style={estilos.tEnc} fixed>
            <Text style={estilos.cFolio}>Orden</Text>
            <Text style={estilos.cFecha}>Fecha</Text>
            <Text style={estilos.cConcepto}>Concepto</Text>
            <Text style={estilos.cNum}>Ejecutado</Text>
            <Text style={estilos.cNum}>Anticipo</Text>
            <Text style={estilos.cNum}>Amortización</Text>
            <Text style={estilos.cNum}>Retención</Text>
            <Text style={estilos.cNum}>Neto girado</Text>
          </View>
          {movimientos.length === 0 && (
            <View style={estilos.tFila}><Text style={estilos.sinObservaciones}>Este contrato aún no tiene órdenes de compra vigentes.</Text></View>
          )}
          {movimientos.map((m, i) => (
            <View key={m.folio} style={i % 2 ? estilos.tFilaAlt : estilos.tFila} wrap={false}>
              <View style={estilos.cFolio}>
                <Text style={estilos.folio}>{m.folio}</Text>
                {m.tipo_pago === 'ANTICIPO' && <Text style={estilos.etiquetaAnticipo}>ANTICIPO</Text>}
              </View>
              <Text style={estilos.cFecha}>{fecha(m.fecha)}</Text>
              <Text style={estilos.cConcepto}>{conceptoMovimiento(m)}</Text>
              <Text style={estilos.cNum}>{pesos(m.ejecutado, { guion: true })}</Text>
              <Text style={estilos.cNum}>{pesos(m.anticipo, { guion: true })}</Text>
              <Text style={estilos.cNum}>{Number(m.amortizacion) ? `-${pesos(m.amortizacion)}` : '—'}</Text>
              <Text style={estilos.cNum}>{Number(m.retencion) ? `-${pesos(m.retencion)}` : '—'}</Text>
              <Text style={[estilos.cNum, { fontFamily: 'Helvetica-Bold' }]}>{pesos(m.neto)}</Text>
            </View>
          ))}
          {movimientos.length > 0 && (
            <View style={estilos.tTotal} wrap={false}>
              <Text style={{ width: '42%' }}>Totales</Text>
              <Text style={estilos.cNum}>{pesos(totales.ejecutado)}</Text>
              <Text style={estilos.cNum}>{pesos(totales.anticipo)}</Text>
              <Text style={estilos.cNum}>{Number(totales.amortizacion) ? `-${pesos(totales.amortizacion)}` : '—'}</Text>
              <Text style={estilos.cNum}>{Number(totales.retencion) ? `-${pesos(totales.retencion)}` : '—'}</Text>
              <Text style={estilos.cNum}>{pesos(totales.neto)}</Text>
            </View>
          )}
        </View>

        <View wrap={false}>
          <Text style={estilos.seccion}>Saldos del contrato</Text>
          <View style={estilos.saldos}>
            <View style={estilos.bloque}>
              <View style={estilos.saldoFila}><Text>Valor del contrato</Text><Text>{pesos(contrato.valor)}</Text></View>
              <View style={estilos.saldoFila}><Text>Ejecutado</Text><Text>{pesos(totales.ejecutado)}</Text></View>
              {Number(saldos.sobre_ejecucion) > 0
                ? <View style={estilos.saldoFilaDestacada}><Text style={{ color: ROJO }}>Sobreejecución</Text><Text style={{ color: ROJO }}>{pesos(saldos.sobre_ejecucion)}</Text></View>
                : <View style={estilos.saldoFilaDestacada}><Text>Por ejecutar</Text><Text>{pesos(saldos.por_ejecutar)}</Text></View>}
            </View>
            <View style={estilos.bloque}>
              <View style={estilos.saldoFila}><Text>Girado neto al contratista</Text><Text>{pesos(saldos.girado_neto)}</Text></View>
              <View style={estilos.saldoFila}><Text>Anticipo por amortizar</Text><Text>{pesos(saldos.anticipo_por_amortizar)}</Text></View>
              <View style={estilos.saldoFilaDestacada}><Text>Retenido por devolver</Text><Text>{pesos(saldos.retenido_por_devolver)}</Text></View>
            </View>
          </View>
        </View>

        <View wrap={false}>
          <Text style={estilos.seccion}>Observaciones</Text>
          {observaciones.length === 0
            ? <Text style={estilos.sinObservaciones}>Sin observaciones.</Text>
            : observaciones.map((o, i) => (
              <View key={i} style={estilos.observacion}>
                <Text style={estilos.vineta}>•</Text>
                <Text style={estilos.observacionTexto}>{o}</Text>
              </View>
            ))}
        </View>

        <View wrap={false}>
          <Text style={estilos.declaracion}>
            Las partes declaran que los valores consignados en este estado de cuenta corresponden a las órdenes de compra
            expedidas con cargo al contrato {contrato.numero} hasta la fecha de corte. Cualquier diferencia deberá
            informarse por escrito dentro de los cinco (5) días hábiles siguientes a su recibo.
          </Text>
          <View style={estilos.firmas}>
            <View style={estilos.firma}>
              <Text style={estilos.rayaFirma}>{nombreContratante}</Text>
              <Text style={estilos.firmaDetalle}>Contratante</Text>
            </View>
            <View style={estilos.firma}>
              <Text style={estilos.rayaFirma}>{contratista.nombre || 'Contratista'}</Text>
              <Text style={estilos.firmaDetalle}>Contratista · {contratista.nit ? `NIT/C.C. ${contratista.nit}` : ''}</Text>
            </View>
          </View>
        </View>

        <View style={estilos.pie} fixed>
          <Text>{mostrarHabitatum ? 'HABITATUM' : (proyecto.emisor || '')} · Estado de cuenta {contrato.numero} · Generado el {fechaColombia(generado_en)} {horaColombia(generado_en)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
