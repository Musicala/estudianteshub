import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

export function resourceHarness(items, source = fs.readFileSync(new URL('../src/data.js', import.meta.url), 'utf8')) {
  source = source.replaceAll('\r', '');
  const scope = source.slice(source.indexOf('function normalizeResourceText('), source.indexOf('/*\n  Diagnóstico: explica'));
  const docs = items.map((r, i) => ({ id: r.id || String(i).padStart(5, '0'), data: () => r }));
  const calls = [];
  const ctx = { DEFAULT_MAX: 120, LIMITS: { maxResourcesPage: 120 },
    safeText: v => String(v ?? '').trim(), safeArray: v => Array.isArray(v) ? v : [], unique: a => [...new Set(a.filter(Boolean))],
    normalizeStudentProcesses: s => s?.processes || [], normalizeResource: r => r,
    collection: () => ({}), libraryDb: {}, LIBRARY_COLLECTIONS: { resources: 'recursos' },
    documentId: () => '__name__', orderBy: field => ({ order: field }), limit: count => ({ count }), startAfter: cursor => ({ cursor }),
    query: (_ref, ...constraints) => constraints,
    getDocs: async constraints => {
      const cursor = constraints.find(x => x.cursor)?.cursor;
      const count = constraints.find(x => x.count)?.count || 1000;
      const start = cursor ? docs.indexOf(cursor) + 1 : 0;
      calls.push(start); const page = docs.slice(start, start + count);
      return { docs: page, size: page.length };
    },
    docsToObjects: snap => snap.docs.map(d => ({ id: d.id, ...d.data() })),
    sortByText: rows => rows, clampLimit: n => n,
    withContextError: error => error,
  };
  vm.createContext(ctx); vm.runInContext(scope.replaceAll('export ', ''), ctx);
  return { ctx, calls };
}

const student = instrument => ({ area: 'Música', instrument, processes: [{ arte: 'Música', detalle: instrument }] });
const resource = (especialidad, extra = {}) => ({ disciplina: 'musica', especialidad, publico: ['estudiantes'], estado: 'Publicado', ...extra });

test('piano y teoría incluyen el material situado después del recurso 1000, sin tope final', async () => {
  const items = Array.from({length: 2000}, (_, i) => resource(i % 2 ? 'piano' : 'guitarra'));
  items.push(resource('teoria-musical', { id: 'teoria-final' }));
  const {ctx, calls} = resourceHarness(items);
  const visible = await ctx.listResources({ student: student('Piano') });
  assert.equal(visible.length, 1001);
  assert.ok(visible.some(r => r.id === 'teoria-final'));
  assert.equal(calls.length, 5);
});

test('cada instrumento recibe su material y teoría; multiárea conserva todos sus procesos', async () => {
  const items = ['piano','guitarra','violin','teoria-musical'].map(x => resource(x));
  items.push({ disciplina: 'danza', especialidad: 'general', publico: ['estudiantes'] });
  const {ctx} = resourceHarness(items);
  for (const instrumento of ['Piano','Guitarra','Violín']) {
    const visible = await ctx.listResources({student: student(instrumento)});
    assert.equal(visible.length, 2, instrumento);
    assert.ok(visible.some(r => r.especialidad === 'teoria-musical'));
  }
  const visible = await ctx.listResources({student: { processes: [{ arte:'Música',detalle:'Piano' }, {arte:'Danza',detalle:'Ballet'}] }});
  assert.equal(visible.length, 3);
});

test('no publica borradores ni material exclusivo de docentes; conserva ocultos manuales', async () => {
  const items = [resource('piano', { id:'visible' }), resource('piano', { estado:'borrador' }), resource('piano', { publico:['docentes'] }), resource('piano', { id:'oculto' })];
  const {ctx} = resourceHarness(items);
  const visible = await ctx.listResources({student: {...student('Piano'), excludedResourceIds:['oculto']}});
  assert.deepEqual(Array.from(visible, r=>r.id), ['visible']);
});

test('un error en una página impide presentar un catálogo incompleto como completo', async () => {
  const {ctx} = resourceHarness(Array.from({length:501},()=>resource('piano')));
  const original = ctx.getDocs; let n=0;ctx.getDocs = q => ++n===2 ? Promise.reject(Error('sin conexión')) : original(q);
  await assert.rejects(ctx.listResources({student:student('Piano')}), /sin conexión/);
});
