import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { EncabezadoPDF, COLOR_DORADO, COLOR_FONDO } from './EncabezadoPDF';

// ============================================================
// Manual de uso y mantenimiento que se entrega al cliente al final de la obra.
// Datos: tablas manual_* (migración 048), alimentadas por el chat de cada obra.
// Misma base visual de los PDF de la app. NUNCA lleva precios ni costos.
// Paleta de marca: carbón #2e2e2e, dorado #b88a52, hueso #efece6, gris cálido #cdc5ba.
// ============================================================

const HUESO = '#efece6';
const HUESO_CLARO = '#f7f5f1';
const GRIS_CALIDO = '#cdc5ba';
const TEXTO = '#2e2e2e';
const TEXTO_SUAVE = '#6b655d';

const e = StyleSheet.create({
  pagina: { paddingTop: 30, paddingHorizontal: 34, paddingBottom: 52, fontSize: 9, fontFamily: 'Helvetica', color: TEXTO, lineHeight: 1.35 },

  portadaCaja: { marginTop: 40, borderLeftWidth: 3, borderLeftColor: COLOR_DORADO, paddingLeft: 14, marginBottom: 26 },
  portadaSup: { fontSize: 9, color: COLOR_DORADO, letterSpacing: 1.5, textTransform: 'uppercase' },
  portadaTitulo: { fontSize: 24, fontFamily: 'Helvetica-Bold', marginTop: 6, lineHeight: 1.15 },
  portadaObra: { fontSize: 13, marginTop: 10, color: TEXTO_SUAVE },
  datos: { borderWidth: 0.5, borderColor: GRIS_CALIDO, borderRadius: 3, marginBottom: 18 },
  datosTitulo: { backgroundColor: HUESO, paddingVertical: 4, paddingHorizontal: 8, fontFamily: 'Helvetica-Bold', fontSize: 9, borderBottomWidth: 1, borderBottomColor: COLOR_DORADO },
  datoFila: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 8 },
  datoEtiqueta: { width: '30%', color: TEXTO_SUAVE },
  datoValor: { width: '70%' },
  presentacion: { textAlign: 'justify', marginBottom: 16 },
  indiceItem: { flexDirection: 'row', paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: HUESO },
  indiceNum: { width: 22, color: COLOR_DORADO, fontFamily: 'Helvetica-Bold' },

  seccion: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  seccionNum: { color: COLOR_DORADO },
  seccionNota: { fontSize: 8, color: TEXTO_SUAVE, marginBottom: 8, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: COLOR_DORADO },
  subtitulo: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 8, marginBottom: 4, color: TEXTO },

  tEnc: { flexDirection: 'row', backgroundColor: COLOR_FONDO, color: 'white', paddingVertical: 4, paddingHorizontal: 4, fontFamily: 'Helvetica-Bold', fontSize: 7.5 },
  tFila: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: HUESO, fontSize: 8 },
  tFilaAlt: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: HUESO, backgroundColor: HUESO_CLARO, fontSize: 8 },
  negrita: { fontFamily: 'Helvetica-Bold' },
  suave: { color: TEXTO_SUAVE, fontSize: 7.5 },
  cuidado: { fontSize: 7.5, color: TEXTO_SUAVE, paddingHorizontal: 4, paddingBottom: 4, borderBottomWidth: 0.5, borderBottomColor: HUESO },

  sistema: { marginBottom: 12, borderWidth: 0.5, borderColor: GRIS_CALIDO, borderRadius: 3 },
  sistemaTitulo: { backgroundColor: HUESO, paddingVertical: 5, paddingHorizontal: 8, fontFamily: 'Helvetica-Bold', fontSize: 10, borderBottomWidth: 1, borderBottomColor: COLOR_DORADO },
  bloque: { paddingHorizontal: 8, paddingTop: 5 },
  bloqueEtiqueta: { fontSize: 7.5, color: COLOR_DORADO, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 1.5 },
  bloqueTexto: { textAlign: 'justify', paddingBottom: 4 },
  alerta: { backgroundColor: HUESO_CLARO, borderLeftWidth: 2, borderLeftColor: COLOR_DORADO, marginHorizontal: 8, marginBottom: 7, marginTop: 2, padding: 5 },

  vacio: { color: TEXTO_SUAVE, fontStyle: 'italic', marginVertical: 6 },
  posventa: { backgroundColor: COLOR_FONDO, borderTopWidth: 2, borderTopColor: COLOR_DORADO, padding: 10, marginBottom: 16 },
  posventaEtiqueta: { fontSize: 7.5, color: COLOR_DORADO, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.6 },
  posventaTexto: { color: 'white', fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 3 },
  posventaNota: { color: GRIS_CALIDO, fontSize: 8, marginTop: 4 },
  pie: { position: 'absolute', bottom: 22, left: 34, right: 34, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: TEXTO_SUAVE, borderTopWidth: 0.5, borderTopColor: GRIS_CALIDO, paddingTop: 5 },
});

const FRECUENCIAS = [
  ['MENSUAL', 'Cada mes'], ['TRIMESTRAL', 'Cada tres meses'], ['SEMESTRAL', 'Cada seis meses'],
  ['ANUAL', 'Cada año'], ['CADA_2_ANOS', 'Cada dos años'], ['SEGUN_USO', 'Según el uso'],
];
const RESPONSABLE = { PROPIETARIO: 'Propietario', TECNICO: 'Técnico especializado' };

function fecha(f) {
  if (!f) return '—';
  const p = String(f).slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(f);
}
function sumarMeses(f, meses) {
  if (!f || !meses) return null;
  const d = new Date(`${String(f).slice(0, 10)}T00:00:00`);
  d.setMonth(d.getMonth() + Number(meses));
  return d.toISOString().slice(0, 10);
}
const t = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));

// En todo costo, los textos base que remiten "al contratista / electricista /
// carpintero del directorio" se dirigen al responsable de la obra.
function aResponsable(texto, responsable) {
  return String(texto || '').replace(
    /(llame|reporte|comuníquese)( al| con el)? (contratista|electricista|carpintero)( del directorio)?/gi,
    (m) => `${m[0] === m[0].toUpperCase() ? 'C' : 'c'}omuníquese con ${responsable}`,
  ).replace(/, que puede atenderlo dentro de la garantía/gi, ', que lo atenderá dentro de la garantía');
}

function Pie({ obra }) {
  return (
    <View style={e.pie} fixed>
      <Text>{obra} · Manual de uso y mantenimiento</Text>
      <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
    </View>
  );
}

function Seccion({ n, titulo, nota }) {
  return (
    <View wrap={false}>
      <Text style={e.seccion}><Text style={e.seccionNum}>{n}. </Text>{titulo}</Text>
      {nota && <Text style={e.seccionNota}>{nota}</Text>}
    </View>
  );
}

export default function PlantillaManualPDF({ datos }) {
  const { proyecto = {}, manual = {}, contactos: todosLosContactos = [], acabados = [], sistemas = [], rutinas = [], anexos = [] } = datos;
  // 050: solo los contactos marcados "Aparece en el PDF"; los demás quedan como respaldo interno.
  const contactos = todosLosContactos.filter((c) => c.mostrar_en_pdf !== false);
  const obra = proyecto.nombre || '';
  const entrega = manual.fecha_entrega;
  // 049: en TODO COSTO el responsable ante el cliente es quien firma la obra
  // (HABITATUM o el emisor configurado): garantías por sistema y posventa única;
  // los contratistas no se muestran con teléfono ni correo. En administración
  // delegada se mantiene el directorio completo con la garantía de cada uno.
  const todoCosto = proyecto.modelo_contratacion === 'TODO_COSTO';
  const responsable = proyecto.mostrar_marca_habitatum === false ? (proyecto.nombre_emisor || 'el constructor') : 'HABITATUM';
  const mostrarContratistas = manual.mostrar_contratistas ?? !todoCosto;
  const conGarantia = contactos.filter((c) => Number(c.garantia_meses) > 0);
  const sistemasConGarantia = sistemas.filter((s) => Number(s.garantia_meses) > 0);
  const espacios = [];
  acabados.forEach((a) => {
    const k = a.espacio || 'General';
    let g = espacios.find((x) => x.espacio === k);
    if (!g) { g = { espacio: k, filas: [] }; espacios.push(g); }
    g.filas.push(a);
  });
  const tituloDirectorio = todoCosto ? 'Participantes en la obra' : 'Directorio de contratistas y proveedores';
  const indice = [
    ...(mostrarContratistas ? [tituloDirectorio] : []), 'Garantías', 'Acabados y materiales',
    'Uso y mantenimiento por sistema', 'Rutinas de mantenimiento preventivo',
    ...(anexos.length ? ['Anexos'] : []),
  ];
  const num = (titulo) => indice.indexOf(titulo) + 1;
  const encabezado = (
    <EncabezadoPDF
      tituloDocumento="Manual de uso y mantenimiento"
      nombreObra={obra}
      mostrarMarcaHabitatum={proyecto.mostrar_marca_habitatum}
      nombreEmisor={proyecto.nombre_emisor}
    />
  );

  return (
    <Document title={`Manual de uso y mantenimiento · ${obra}`}>
      {/* Portada */}
      <Page size="A4" style={e.pagina}>
        {encabezado}
        <View style={e.portadaCaja}>
          <Text style={e.portadaSup}>Entrega de obra</Text>
          <Text style={e.portadaTitulo}>Manual de uso{'\n'}y mantenimiento</Text>
          <Text style={e.portadaObra}>{obra}</Text>
        </View>
        <View style={e.datos}>
          <Text style={e.datosTitulo}>Datos del inmueble</Text>
          <View style={e.datoFila}><Text style={e.datoEtiqueta}>Cliente</Text><Text style={e.datoValor}>{t(manual.cliente)}</Text></View>
          <View style={e.datoFila}><Text style={e.datoEtiqueta}>Dirección</Text><Text style={e.datoValor}>{t(manual.direccion)}</Text></View>
          <View style={e.datoFila}><Text style={e.datoEtiqueta}>Fecha de entrega</Text><Text style={e.datoValor}>{fecha(entrega)}</Text></View>
          {manual.contacto_postventa && !todoCosto && (
            <View style={e.datoFila}><Text style={e.datoEtiqueta}>Contacto posventa</Text><Text style={e.datoValor}>{manual.contacto_postventa}</Text></View>
          )}
        </View>
        {todoCosto && (
          <View style={e.posventa}>
            <Text style={e.posventaEtiqueta}>Posventa y garantías</Text>
            <Text style={e.posventaTexto}>{manual.contacto_postventa || responsable}</Text>
            <Text style={e.posventaNota}>Toda solicitud de garantía o posventa se tramita con {responsable}.</Text>
          </View>
        )}
        {manual.presentacion && <Text style={e.presentacion}>{manual.presentacion}</Text>}
        <Text style={e.subtitulo}>Contenido</Text>
        {indice.map((s, i) => (
          <View key={s} style={e.indiceItem}><Text style={e.indiceNum}>{i + 1}</Text><Text>{s}</Text></View>
        ))}
        <Pie obra={obra} />
      </Page>

      <Page size="A4" style={e.pagina} wrap>
        {/* 1. Directorio (en todo costo: solo referencia, sin contactos, y opcional) */}
        {mostrarContratistas && todoCosto && (
          <>
            <Seccion n={num(tituloDirectorio)} titulo={tituloDirectorio} nota={`Empresas que ejecutaron cada parte de la obra, como referencia. Para garantías y posventa comuníquese con ${responsable}.`} />
            {contactos.length === 0 ? <Text style={e.vacio}>Pendiente por completar.</Text> : (
              <View style={{ marginBottom: 14 }}>
                <View style={e.tEnc}><Text style={{ width: '55%' }}>Actividad</Text><Text style={{ width: '45%' }}>Empresa</Text></View>
                {contactos.map((c, i) => (
                  <View key={c.id} style={i % 2 ? e.tFilaAlt : e.tFila} wrap={false}>
                    <Text style={{ width: '55%', paddingRight: 4 }}>{t(c.actividad)}</Text>
                    <Text style={{ width: '45%' }}>{c.empresa}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
        {mostrarContratistas && !todoCosto && (<>
        <Seccion n={num(tituloDirectorio)} titulo={tituloDirectorio} nota="Personas y empresas que ejecutaron o suministraron cada parte de la obra. Contáctelos para garantías, reparaciones o ampliaciones." />
        {contactos.length === 0 ? <Text style={e.vacio}>Pendiente por completar.</Text> : (
          <View style={{ marginBottom: 14 }}>
            <View style={e.tEnc} fixed>
              <Text style={{ width: '34%' }}>Actividad</Text><Text style={{ width: '32%' }}>Empresa / contacto</Text>
              <Text style={{ width: '16%' }}>Teléfono</Text><Text style={{ width: '18%' }}>Correo</Text>
            </View>
            {contactos.map((c, i) => (
              <View key={c.id} style={i % 2 ? e.tFilaAlt : e.tFila} wrap={false}>
                <Text style={{ width: '34%', paddingRight: 4 }}>{t(c.actividad)}</Text>
                <View style={{ width: '32%', paddingRight: 4 }}>
                  <Text style={e.negrita}>{c.empresa}</Text>
                  {c.persona_contacto && c.persona_contacto !== c.empresa && <Text style={e.suave}>{c.persona_contacto}</Text>}
                  {c.notas && <Text style={e.suave}>{c.notas}</Text>}
                </View>
                <Text style={{ width: '16%' }}>{t(c.telefono)}</Text>
                <Text style={{ width: '18%' }}>{t(c.correo)}</Text>
              </View>
            ))}
          </View>
        )}
        </>)}

        {/* 2. Garantías */}
        <Seccion n={num('Garantías')} titulo="Garantías" nota={todoCosto
          ? `Garantías otorgadas por ${responsable}, contadas desde la fecha de entrega (${fecha(entrega)}). Toda solicitud de garantía se tramita con ${responsable}. La garantía no cubre daños por mal uso, golpes, falta de mantenimiento o intervenciones de terceros.`
          : `Vigencia contada desde la fecha de entrega (${fecha(entrega)}), salvo que se indique otra fecha. La garantía no cubre daños por mal uso, golpes, falta de mantenimiento o intervenciones de terceros.`} />
        {todoCosto ? (sistemasConGarantia.length === 0 ? <Text style={e.vacio}>Pendiente por completar.</Text> : (
          <View style={{ marginBottom: 14 }}>
            <View style={e.tEnc}>
              <Text style={{ width: '50%' }}>Sistema</Text><Text style={{ width: '14%', textAlign: 'center' }}>Meses</Text>
              <Text style={{ width: '18%' }}>Desde</Text><Text style={{ width: '18%' }}>Hasta</Text>
            </View>
            {sistemasConGarantia.map((s, i) => (
              <View key={s.id} style={i % 2 ? e.tFilaAlt : e.tFila} wrap={false}>
                <Text style={{ width: '50%', paddingRight: 4 }}>{s.titulo}</Text>
                <Text style={{ width: '14%', textAlign: 'center' }}>{Number(s.garantia_meses)}</Text>
                <Text style={{ width: '18%' }}>{fecha(entrega)}</Text>
                <Text style={{ width: '18%' }}>{fecha(sumarMeses(entrega, s.garantia_meses))}</Text>
              </View>
            ))}
          </View>
        )) : conGarantia.length === 0 ? <Text style={e.vacio}>Pendiente por completar.</Text> : (
          <View style={{ marginBottom: 14 }}>
            <View style={e.tEnc}>
              <Text style={{ width: '40%' }}>Actividad</Text><Text style={{ width: '30%' }}>Responsable</Text>
              <Text style={{ width: '10%', textAlign: 'center' }}>Meses</Text><Text style={{ width: '10%' }}>Desde</Text><Text style={{ width: '10%' }}>Hasta</Text>
            </View>
            {conGarantia.map((c, i) => {
              const desde = c.garantia_desde || entrega;
              const hasta = c.garantia_hasta || sumarMeses(desde, c.garantia_meses);
              return (
                <View key={c.id} style={i % 2 ? e.tFilaAlt : e.tFila} wrap={false}>
                  <Text style={{ width: '40%', paddingRight: 4 }}>{t(c.actividad)}</Text>
                  <Text style={{ width: '30%', paddingRight: 4 }}>{c.empresa}</Text>
                  <Text style={{ width: '10%', textAlign: 'center' }}>{Number(c.garantia_meses)}</Text>
                  <Text style={{ width: '10%' }}>{fecha(desde)}</Text>
                  <Text style={{ width: '10%' }}>{fecha(hasta)}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* 3. Acabados */}
        <Seccion n={num('Acabados y materiales')} titulo="Acabados y materiales" nota="Materiales instalados en cada espacio, con su referencia y dónde comprarlos, para reponerlos o retocarlos con exactamente el mismo producto." />
        {espacios.length === 0 ? <Text style={e.vacio}>Pendiente por completar.</Text> : espacios.map((g) => (
          <View key={g.espacio} style={{ marginBottom: 10 }}>
            <Text style={e.subtitulo}>{g.espacio}</Text>
            <View style={e.tEnc}>
              <Text style={{ width: '18%' }}>Elemento</Text><Text style={{ width: '22%' }}>Material</Text>
              <Text style={{ width: '24%' }}>Marca / referencia</Text><Text style={{ width: '14%' }}>Color</Text><Text style={{ width: '22%' }}>Dónde comprar</Text>
            </View>
            {g.filas.map((a, i) => (
              <View key={a.id} wrap={false}>
                <View style={i % 2 ? e.tFilaAlt : e.tFila}>
                  <Text style={[{ width: '18%', paddingRight: 4 }, e.negrita]}>{a.elemento}</Text>
                  <Text style={{ width: '22%', paddingRight: 4 }}>{t(a.material)}</Text>
                  <Text style={{ width: '24%', paddingRight: 4 }}>{[a.marca, a.referencia].filter(Boolean).join(' · ') || '—'}</Text>
                  <Text style={{ width: '14%', paddingRight: 4 }}>{t(a.color)}</Text>
                  <Text style={{ width: '22%' }}>{t(a.donde_comprar)}</Text>
                </View>
                {(a.cuidado || a.notas) && <Text style={e.cuidado}>{[a.cuidado, a.notas].filter(Boolean).join(' ')}</Text>}
              </View>
            ))}
          </View>
        ))}
        <Pie obra={obra} />
      </Page>

      {/* 4. Sistemas */}
      <Page size="A4" style={e.pagina} wrap>
        <Seccion n={num('Uso y mantenimiento por sistema')} titulo="Uso y mantenimiento por sistema" nota="Recomendaciones de uso, cuidados periódicos y qué hacer ante una falla en cada sistema del inmueble." />
        {sistemas.length === 0 ? <Text style={e.vacio}>Pendiente por completar.</Text> : sistemas.map((s) => (
          <View key={s.id} style={e.sistema} wrap={false}>
            <Text style={e.sistemaTitulo}>{s.titulo}</Text>
            {s.descripcion && <View style={e.bloque}><Text style={e.bloqueEtiqueta}>Qué se instaló</Text><Text style={e.bloqueTexto}>{s.descripcion}</Text></View>}
            {s.uso && <View style={e.bloque}><Text style={e.bloqueEtiqueta}>Uso</Text><Text style={e.bloqueTexto}>{s.uso}</Text></View>}
            {s.mantenimiento && <View style={e.bloque}><Text style={e.bloqueEtiqueta}>Mantenimiento</Text><Text style={e.bloqueTexto}>{s.mantenimiento}</Text></View>}
            {s.que_hacer && <View style={e.alerta}><Text style={e.bloqueEtiqueta}>Qué hacer si falla</Text>
              <Text>{todoCosto ? aResponsable(s.que_hacer, responsable) : s.que_hacer}</Text></View>}
          </View>
        ))}

        {/* 5. Rutinas */}
        <View break>
          <Seccion n={num('Rutinas de mantenimiento preventivo')} titulo="Rutinas de mantenimiento preventivo" nota="Calendario sugerido. Las tareas de técnico especializado deben hacerlas personas calificadas; las demás puede hacerlas el propietario." />
        </View>
        {rutinas.length === 0 ? <Text style={e.vacio}>Pendiente por completar.</Text> : FRECUENCIAS.map(([k, etiqueta]) => {
          const filas = rutinas.filter((r) => r.frecuencia === k);
          if (!filas.length) return null;
          return (
            <View key={k} style={{ marginBottom: 8 }} wrap={false}>
              <Text style={e.subtitulo}>{etiqueta}</Text>
              <View style={e.tEnc}><Text style={{ width: '62%' }}>Tarea</Text><Text style={{ width: '18%' }}>Sistema</Text><Text style={{ width: '20%' }}>Responsable</Text></View>
              {filas.map((r, i) => (
                <View key={r.id} style={i % 2 ? e.tFilaAlt : e.tFila}>
                  <Text style={{ width: '62%', paddingRight: 4 }}>{r.tarea}</Text>
                  <Text style={{ width: '18%' }}>{(sistemas.find((s) => s.sistema === r.sistema)?.titulo) || r.sistema}</Text>
                  <Text style={{ width: '20%' }}>{RESPONSABLE[r.responsable] || r.responsable}</Text>
                </View>
              ))}
            </View>
          );
        })}

        {/* 6. Anexos */}
        {anexos.length > 0 && (
          <View>
            <Seccion n={num('Anexos')} titulo="Anexos" nota="Manuales, fichas técnicas y certificados entregados por los proveedores y contratistas." />
            {anexos.map((a, i) => (
              <View key={a.id} style={i % 2 ? e.tFilaAlt : e.tFila}>
                <Text style={{ width: '70%' }}>{a.titulo}</Text><Text style={{ width: '30%' }}>{t(a.proveedor)}</Text>
              </View>
            ))}
          </View>
        )}
        <Pie obra={obra} />
      </Page>
    </Document>
  );
}
