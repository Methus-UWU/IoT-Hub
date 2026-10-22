import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const out = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(out, '../..');
const schema = readFileSync(path.join(root, 'backend/prisma/schema.prisma'), 'utf8');
const migrationsPath = path.join(root, 'backend/prisma/migrations');
const sql = readdirSync(migrationsPath, { withFileTypes: true }).filter(d => d.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name))
  .map(d => readFileSync(path.join(migrationsPath, d.name, 'migration.sql'), 'utf8')).join('\n');
const blocks = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
const names = new Map(blocks.map(([, name, body]) => [name, body.match(/@@map\("([^"]+)"\)/)[1]]));
const types = { String: 'TEXT', Int: 'INTEGER', Float: 'DOUBLE PRECISION', Boolean: 'BOOLEAN', DateTime: 'TIMESTAMP(3)', Json: 'JSONB' };
const tables = new Map();
const relations = [];
for (const [, model, body] of blocks) {
  const name = names.get(model);
  const fields = [...body.matchAll(/^\s+(\w+)\s+(\w+)(\?|\[\])?([^\n]*)/gm)]
    .filter(([, , type]) => types[type]).map(([, prop, type, optional, attrs]) => ({
      prop, name: attrs.match(/@map\("([^"]+)"\)/)?.[1] ?? prop,
      type: attrs.includes('@db.Uuid') ? 'UUID' : attrs.includes('@db.SmallInt') ? 'SMALLINT'
        : attrs.match(/@db\.VarChar\((\d+)\)/) ? `VARCHAR(${attrs.match(/@db\.VarChar\((\d+)\)/)[1]})`
        : types[type] + (optional === '[]' ? '[]' : ''),
      list: optional === '[]', nullable: optional === '?', pk: /@id\b/.test(attrs), unique: /@unique\b/.test(attrs),
    }));
  const composite = body.match(/@@id\(\[([^\]]+)\]/)?.[1].split(',').map(s => s.trim()) ?? [];
  fields.forEach(f => { if (composite.includes(f.prop)) f.pk = true; });
  const uniques = [...body.matchAll(/@@unique\(\[([^\]]+)\]/g)].map(m => m[1].split(',').map(p => fields.find(f => f.prop === p.trim()).name));
  for (const [, target, props, refs] of body.matchAll(/^\s+\w+\s+(\w+)\??\s+@relation\([^\n]*fields:\s*\[([^\]]+)\],\s*references:\s*\[([^\]]+)\]/gm)) {
    assert(!props.includes(','), 'Composite FK needs explicit rendering support');
    const field = fields.find(f => f.prop === props.trim());
    field.fk = true;
    relations.push({ from: name, field: field.name, to: names.get(target), refProp: refs.trim(), optional: field.nullable, unique: field.unique || field.pk });
  }
  tables.set(name, { name, fields, uniques });
}
assert(/FOREIGN KEY \("id"\) REFERENCES auth\.users \("id"\)/.test(sql));
tables.set('auth.users', { name: 'auth.users', external: true, fields: [{ prop: 'id', name: 'id', type: 'UUID', pk: true }], uniques: [] });
tables.get('users').fields.find(f => f.name === 'id').fk = true;
relations.push({ from: 'users', field: 'id', to: 'auth.users', refProp: 'id', optional: false, unique: true });
for (const r of relations) {
  r.ref = tables.get(r.to).fields.find(f => f.prop === r.refProp).name;
  r.description = `${r.from}.${r.field} → ${r.to}.${r.ref}`;
}

// Check physical types against the SQL that created each table. Later column
// changes must be reviewed explicitly rather than silently inferred.
for (const t of tables.values()) {
  if (t.external) continue;
  const ddl = sql.match(new RegExp('CREATE TABLE "' + t.name + '" \\(([\\s\\S]*?)\\n\\);'))?.[1];
  assert(ddl, `Missing migration table: ${t.name}`);
  // Columns added later arrive as `ALTER TABLE ... ADD COLUMN`, quoted or not.
  const added = [...sql.matchAll(new RegExp('ALTER TABLE (?:"?public"?\\.)?"?' + t.name + '"?\\s([\\s\\S]*?);', 'g'))]
    .flatMap(m => [...m[1].matchAll(/ADD COLUMN\s+([^,\n]+)/g)].map(c => c[1].replace(/^(\w+)/, '"$1"')));
  const lines = [...ddl.split('\n'), ...added];
  for (const f of t.fields) {
    const line = lines.find(l => l.trim().startsWith(`"${f.name}" `));
    assert(line?.includes(`"${f.name}" ${f.type}`), `SQL type mismatch: ${t.name}.${f.name}`);
    // Prisma cannot declare a nullable list, so a list column takes its nullability from SQL.
    if (f.list) f.nullable = !line.includes('NOT NULL');
    assert.equal(!line.includes('NOT NULL'), !!f.nullable, `Nullability mismatch: ${t.name}.${f.name}`);
  }
}

const groups = [
  { title: 'Identity & access', subtitle: 'Application profiles, platform roles and the Supabase Auth boundary', color: '#2463AA', bg: '#EDF4FC', rows: [['users', 'roles', 'auth.users']] },
  { title: 'Workspaces & membership', subtitle: 'Ownership and explicit membership define the collaboration boundary', color: '#14796B', bg: '#ECF8F4', rows: [['workspaces', 'workspace_members']] },
  { title: 'Projects & circuit design', subtitle: 'Project source files, placed components and pin-to-pin connections', color: '#36833C', bg: '#F0F8ED', rows: [['projects', 'project_files'], ['project_components', 'project_connections']] },
  { title: 'Plans & subscriptions', subtitle: 'Subscription tiers, per-plan limits and the user subscription', color: '#A86A10', bg: '#FFF7E7', rows: [['plans', 'plan_limits', 'user_subscriptions']] },
  { title: 'Community', subtitle: 'Posts, answers, tags and votes, including optional and self-referencing links', color: '#7446AA', bg: '#F5EFFB', rows: [['community_posts', 'community_comments', 'community_tags'], ['community_votes', 'community_post_tags']] },
  { title: 'Activity & history', subtitle: 'Private sign-in events and per-user search history', color: '#506679', bg: '#F0F4F7', rows: [['login_events', 'search_history']] },
  { title: 'Firmware builds', subtitle: 'Queued build jobs claimed by the isolated builder and the images they produce', color: '#B5452F', bg: '#FCF0EC', rows: [['build_jobs', 'build_artifacts']] },
  { title: 'Dashboards & datastreams', subtitle: 'Per-project datastreams and dashboards, and reusable versioned templates', color: '#1F7A8C', bg: '#EAF6F8', rows: [['project_datastreams', 'project_dashboards'], ['dashboard_templates', 'dashboard_template_versions']] },
  { title: 'Devices & telemetry', subtitle: 'Provisioned devices, their latest values and the telemetry history', color: '#8A5A2B', bg: '#F8F1EA', rows: [['devices', 'device_values', 'telemetry_points']] },
  { title: 'AI assistant & credits', subtitle: 'Profiles, saved conversations, model settings, credit overrides and usage', color: '#9C2F6B', bg: '#FAEEF5', rows: [['ai_profiles', 'ai_conversations', 'ai_messages'], ['ai_settings', 'ai_credit_overrides', 'ai_usage_events']] },
];
const CW = 520, RH = 30, cols = [260, 900, 1540];
// Leave a dedicated channel on each side of every table.
const canvasW = 2320;
let y = 290;
const rowBands = [];
for (const [gi, g] of groups.entries()) {
  g.y = y; g.index = gi + 1;
  y += 184;
  for (const row of g.rows) {
    const band = { top: y, bottom: 0 };
    row.forEach((name, col) => {
      const t = tables.get(name);
      assert(t, name);
      Object.assign(t, { x: cols[col], y, group: g, band });
      t.fields.sort((a, b) => Number(!!b.pk) - Number(!!a.pk) || Number(!!b.fk) - Number(!!a.fk));
      t.h = 80 + t.fields.length * RH + 16 + Math.max(t.uniques.length, t.external ? 2 : 0) * 25;
      t.fields.forEach((f, i) => { f.y = y + 95 + i * RH; });
      band.bottom = Math.max(band.bottom, y + t.h);
    });
    rowBands.push(band);
    y = band.bottom + 120;
  }
  g.h = y - g.y - 54;
  y += 10;
}
const H = y + 220;
assert.equal(groups.flatMap(g => g.rows.flat()).length, tables.size);
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const text = (x, y, value, cls = '', attrs = '') => `<text x="${x}" y="${y}" class="${cls}" ${attrs}>${esc(value)}</text>`;
const rect = (x, y, w, h, fill, stroke = 'none', rx = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}"/>`;

// Orthogonal paths use clear row gutters. Foreign keys in another group travel
// through dedicated left-hand lanes, like the supplied visual reference.
const used = new Map();
function channel(key) { const n = used.get(key) ?? 0; used.set(key, n + 1); return n; }
function route(r, i) {
  const a = tables.get(r.from), b = tables.get(r.to);
  const sy = a.fields.find(f => f.name === r.field).y - 5;
  const ty = b.fields.find(f => f.name === r.ref).y - 5;
  let points;
  if (a.band === b.band && a !== b && Math.abs(a.x - b.x) === 640) {
    const right = a.x < b.x;
    const sx = right ? a.x + CW : a.x, tx = right ? b.x : b.x + CW;
    const mid = Math.min(a.x, b.x) + CW + 26 + channel(`gap-${a.y}-${Math.min(a.x, b.x)}`) * 14;
    points = [[sx, sy], [mid, sy], [mid, ty], [tx, ty]];
  } else if (a === b) {
    const edge = a.x + CW;
    points = [[edge, sy], [edge + 40, sy], [edge + 40, ty], [edge, ty]];
  } else {
    const sa = channel(`exit-${a.name}`), sb = channel(`enter-${b.name}`);
    const sx = a.x, tx = b.x;
    // Lanes share the left margin, so they tighten as the schema gains foreign keys.
    const outer = 34 + i * Math.min(5, 90 / relations.length);
    const sg = a.band.top - 20 - (i % 7) * 11;
    const tg = b.band.top - 20 - ((i + 3) % 7) * 11;
    points = [[sx, sy], [sx - 18 - sa * 9, sy], [sx - 18 - sa * 9, sg], [outer, sg], [outer, tg], [tx - 18 - sb * 9, tg], [tx - 18 - sb * 9, ty], [tx, ty]];
  }
  r.points = points;
  const d = points.map(([px, py], j) => `${j ? 'L' : 'M'}${px},${py}`).join(' ');
  return `<g class="relation" data-from="${a.name}" data-to="${b.name}"><title>${esc(r.description)}; each child has ${r.optional ? '0..1' : '1'} parent; each parent has ${r.unique ? '0..1' : '0..N'} children</title><path d="${d}" fill="none" stroke="white" stroke-width="5"/><path d="${d}" fill="none" stroke="${a.group.color}" stroke-width="1.8" stroke-linejoin="round" marker-end="url(#arrow-${a.group.index})"/><circle cx="${points[0][0]}" cy="${sy}" r="3" fill="${a.group.color}"/></g>`;
}
const panels = groups.map(g => rect(205, g.y, 1900, g.h, g.bg, g.color, 20)
  + rect(233, g.y + 26, 42, 38, g.color, 'none', 9)
  + text(254, g.y + 52, String(g.index).padStart(2, '0'), 'number', 'text-anchor="middle"')
  + text(294, g.y + 53, g.title, 'group-title')
  + text(294, g.y + 80, g.subtitle, 'subtitle')
  + text(2070, g.y + 52, `${g.rows.flat().length} TABLES`, 'eyebrow', 'text-anchor="end"')).join('');
const edges = relations.map(route).join('');
for (const r of relations) {
  for (let i = 1; i < r.points.length; i++) {
    const [ax, ay] = r.points[i - 1], [bx, by] = r.points[i];
    for (const t of tables.values()) {
      const crosses = ax === bx
        ? ax > t.x && ax < t.x + CW && Math.max(ay, by) > t.y && Math.min(ay, by) < t.y + t.h
        : ay > t.y && ay < t.y + t.h && Math.max(ax, bx) > t.x && Math.min(ax, bx) < t.x + CW;
      assert(!crosses, `Relationship crosses table: ${r.description} / ${t.name}`);
    }
  }
}
const cards = [...tables.values()].map(t => {
  let s = `<g class="entity" id="${t.name}" data-name="${t.name}">`;
  s += rect(t.x, t.y, CW, t.h, '#FFFFFF', t.group.color, 9);
  s += `<path d="M${t.x + 9},${t.y}h${CW - 18}q9,0 9,9v43h-${CW}v-43q0,-9 9,-9Z" fill="${t.group.color}"/>`;
  s += text(t.x + 20, t.y + 34, t.name, 'table-title');
  s += text(t.x + CW - 18, t.y + 33, t.external ? 'EXTERNAL' : 'public', 'schema', 'text-anchor="end"');
  s += rect(t.x + 1, t.y + 52, CW - 2, 28, '#F7F9FC');
  s += text(t.x + 16, t.y + 71, 'KEY', 'column') + text(t.x + 94, t.y + 71, 'COLUMN', 'column') + text(t.x + CW - 18, t.y + 71, 'POSTGRESQL TYPE', 'column', 'text-anchor="end"');
  for (const [i, f] of t.fields.entries()) {
    if (i % 2) s += rect(t.x + 1, f.y - 20, CW - 2, RH, '#F8FAFC');
    const flags = [f.pk && 'PK', f.fk && 'FK', f.unique && !f.pk && 'UQ'].filter(Boolean).join(' ');
    if (flags) s += text(t.x + 16, f.y, flags, f.pk ? 'key pk' : 'key');
    s += text(t.x + 94, f.y, f.name, 'field', f.pk ? 'font-weight="700"' : '');
    s += text(t.x + CW - 18, f.y, `${f.type}${f.nullable ? ' ?' : ''}`, 'type', 'text-anchor="end"');
  }
  let noteY = t.y + 80 + t.fields.length * RH + 20;
  for (const u of t.uniques) { s += text(t.x + 16, noteY, `UQ (${u.join(', ')})`, 'constraint'); noteY += 25; }
  if (t.external) {
    s += text(t.x + 16, noteY, 'Reference only: id is the only field shown.', 'constraint');
    s += text(t.x + 16, noteY + 25, 'Supabase-managed table; outside public schema.', 'constraint');
  }
  return s + '</g>';
}).join('');
const totalFields = [...tables.values()].filter(t => !t.external).reduce((sum, t) => sum + t.fields.length, 0);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${H}" viewBox="0 0 ${canvasW} ${H}" role="img" aria-labelledby="title desc">
<title id="title">IoT Hub — Entity Relationship Diagram</title><desc id="desc">${tables.size - 1} public tables, ${totalFields} columns and ${relations.length} foreign keys, grouped by domain. Arrows run from foreign keys to referenced keys. An external auth.users reference is included.</desc>
<defs>${groups.map(g => `<marker id="arrow-${g.index}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1L9 5L1 9" fill="none" stroke="${g.color}" stroke-width="1.5"/></marker>`).join('')}</defs>
<style>text{font-family:'Segoe UI',Arial,sans-serif;fill:#193047}.heading{font-size:52px;font-weight:750;letter-spacing:-1px}.eyebrow{font-size:14px;font-weight:700;letter-spacing:1.5px;fill:#597083}.intro{font-size:20px;fill:#526B80}.number{font-size:18px;font-weight:700;fill:white}.group-title{font-size:27px;font-weight:700}.subtitle{font-size:16px;fill:#587084}.table-title{font-size:23px;font-weight:700;fill:white}.schema{font-size:13px;fill:#FFFFFF;opacity:.8}.column{font-size:11px;font-weight:700;letter-spacing:1px;fill:#738293}.field{font-size:17px}.type{font-family:Consolas,monospace;font-size:15px;fill:#52677B}.key{font-size:12px;font-weight:750;fill:#2463AA}.pk{fill:#A96807}.constraint{font-size:13px;fill:#62758A}.legend{font-size:17px;fill:#425B71}.relation{opacity:.73}.relation:hover{opacity:1}.entity{cursor:default}</style>
${rect(0, 0, canvasW, H, '#FFFFFF')}
${text(205, 61, 'DATABASE ATLAS / 01', 'eyebrow')}
${text(205, 122, 'IoT Hub', 'heading')}${text(205, 165, 'Entity Relationship Diagram', 'intro')}
${text(2105, 98, `${tables.size - 1} TABLES   /   ${relations.length} RELATIONSHIPS   /   ${groups.length} DOMAINS`, 'eyebrow', 'text-anchor="end"')}
${text(2105, 132, 'PostgreSQL · public schema + auth.users reference', 'intro', 'text-anchor="end"')}
${rect(205, 197, 1900, 60, '#F3F6FA', 'none', 12)}
${text(231, 234, 'PK  Primary key', 'legend')}${text(460, 234, 'FK  Foreign key', 'legend')}${text(685, 234, 'UQ  Unique', 'legend')}${text(895, 234, '?  Nullable', 'legend')}${text(1090, 234, 'Arrows: FK → referenced key', 'legend')}${text(1550, 234, 'All unmarked columns: NOT NULL', 'legend')}
${panels}${edges}${cards}
${text(205, y + 23, 'SCHEMA NOTES', 'eyebrow')}
${text(205, y + 58, 'community_votes: exactly one of post_id / comment_id is set; value is -1 or 1.', 'legend')}
${text(205, y + 88, 'TEXT is the actual SQL type. TIMESTAMP(3) has millisecond precision and no time zone.', 'legend')}
${text(205, y + 118, 'Composite unique keys appear below their table. Full cardinalities are listed in the companion HTML.', 'legend')}
${text(205, y + 162, 'Source: backend/prisma/schema.prisma + versioned migrations · Repository snapshot, 2026-10-18', 'subtitle')}
${text(205, y + 190, 'Supabase-managed auth.users is abbreviated. Planned domains without persisted tables are excluded.', 'subtitle')}
</svg>`;
writeFileSync(path.join(out, 'iot-hub-erd.svg'), svg);
const relationRows = relations.map(r => `<tr><td>${esc(r.from)}.${esc(r.field)}</td><td>${esc(r.to)}.${esc(r.ref)}</td><td>${r.optional ? '0..1' : '1'}</td><td>${r.unique ? '0..1' : '0..N'}</td></tr>`).join('');
writeFileSync(path.join(out, 'iot-hub-erd.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IoT Hub ER Diagram</title><style>body{margin:0;background:#e8edf3;color:#193047;font:15px 'Segoe UI',sans-serif}header{position:sticky;top:0;z-index:1;background:#142c43;color:white;padding:14px 24px;display:flex;align-items:center;gap:12px;box-shadow:0 2px 8px #0002}header strong{margin-right:auto}button,a{font:inherit;padding:7px 14px;border:0;border-radius:6px;cursor:pointer;background:#fff;color:#193047;text-decoration:none}main{overflow:auto;padding:24px}#diagram{width:1320px;margin:auto;box-shadow:0 3px 24px #142c4320}svg{display:block;width:100%;height:auto}.dim{opacity:.12}.relation.focus{opacity:1}.relation.focus path{stroke-width:3}details{max-width:1260px;margin:20px auto 50px;background:white;padding:24px;border-radius:12px}summary{cursor:pointer;font-weight:700}table{width:100%;border-collapse:collapse;margin-top:18px}td,th{text-align:left;padding:9px;border-bottom:1px solid #e2e8f0;font-size:13px}p{color:#52677b}@media print{header,details{display:none}main{padding:0}#diagram{width:100%!important;box-shadow:none}}</style><header><strong>IoT Hub · ER Diagram</strong><span>Click a table to highlight its relationships</span><button id="out" aria-label="Zoom out">−</button><button id="in" aria-label="Zoom in">+</button><button id="fit">Fit</button><button id="reset">Reset highlight</button><a href="iot-hub-erd.svg" download>SVG</a><a href="iot-hub-erd.png" download>PNG</a><a href="iot-hub-erd.pdf" download>PDF</a></header><main><div id="diagram">${svg}</div></main><details><summary>Relationship index · ${relations.length} foreign keys</summary><p>Cardinality reflects database constraints. Each FK row is a child; the referenced row is its parent. Cross-table business rules may impose additional restrictions.</p><table><thead><tr><th>Child / foreign key</th><th>Parent / referenced key</th><th>Parents per child</th><th>Children per parent</th></tr></thead><tbody>${relationRows}</tbody></table></details><script>const box=document.querySelector('#diagram');let width=1320;function zoom(w){width=Math.max(520,Math.min(4000,w));box.style.width=width+'px'}document.querySelector('#in').onclick=()=>zoom(width*1.25);document.querySelector('#out').onclick=()=>zoom(width/1.25);document.querySelector('#fit').onclick=()=>zoom(innerWidth-64);function reset(){document.querySelectorAll('.dim,.focus').forEach(e=>e.classList.remove('dim','focus'))}document.querySelector('#reset').onclick=reset;document.querySelectorAll('.entity').forEach(e=>e.onclick=()=>{reset();const name=e.dataset.name;const related=new Set([name]);document.querySelectorAll('.relation').forEach(r=>{const hit=r.dataset.from===name||r.dataset.to===name;r.classList.add(hit?'focus':'dim');if(hit){related.add(r.dataset.from);related.add(r.dataset.to)}});document.querySelectorAll('.entity').forEach(t=>t.classList.toggle('dim',!related.has(t.dataset.name)))});</script></html>`);
writeFileSync(path.join(out, 'iot-hub-erd-data.json'), JSON.stringify({ publicTables: tables.size - 1, totalFields, width: canvasW, height: H, tables: [...tables.values()].map(({ name, fields, uniques, external }) => ({ name, fields, uniques, external })), relations: relations.map(({ points, ...r }) => r) }, null, 2));
console.log(JSON.stringify({ publicTables: tables.size - 1, columns: totalFields, foreignKeys: relations.length, width: canvasW, height: H }));
