'use strict';

const express = require('express');
const config = require('../config');
const logger = require('../utils/logger');

const router = express.Router();

// ── Middleware de auth do dashboard ──────────────────────────────────────────
function dashboardAuth(req, res, next) {
  const apiKey = config.admin.apiKey;
  if (!apiKey) return next();

  const provided = req.query.key || req.headers['x-api-key'];
  if (!provided || provided !== apiKey) {
    return res.status(401).send(`
      <html><body style="font-family:sans-serif;padding:2rem">
        <h2>🔒 Acesso restrito</h2>
        <p>Informe a chave de acesso na URL: <code>?key=SUA_CHAVE</code></p>
      </body></html>
    `);
  }
  next();
}

router.get('/', dashboardAuth, (req, res) => {
  const apiKey = config.admin.apiKey ? `?key=${config.admin.apiKey}` : '';
  const html = buildDashboardHtml(apiKey);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

function buildDashboardHtml(apiKey) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IA Atendimento — Dashboard</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<style>
  body { background: #0f172a; color: #e2e8f0; }
  .card { background: #1e293b; border-radius: 12px; padding: 1.25rem; }
  .badge-frio { background:#334155; color:#94a3b8; }
  .badge-morno { background:#78350f; color:#fcd34d; }
  .badge-quente { background:#7f1d1d; color:#fca5a5; }
  .badge-limpa { background:#1e3a5f; color:#93c5fd; }
  .badge-revisao { background:#1a3a2a; color:#86efac; }
  .badge-multa { background:#3b1f5e; color:#c4b5fd; }
  .tag { display:inline-block; padding:2px 8px; border-radius:9999px; font-size:0.7rem; font-weight:600; }
  tr:hover td { background:#1e3a5f22; }
</style>
</head>
<body class="min-h-screen p-4">

<div class="max-w-7xl mx-auto">
  <!-- Header -->
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold text-white">IA Atendimento</h1>
      <p class="text-slate-400 text-sm">Painel de Leads e Conversas</p>
    </div>
    <div class="flex gap-2 items-center">
      <span id="last-update" class="text-slate-500 text-xs"></span>
      <button onclick="loadAll()" class="bg-blue-600 hover:bg-blue-500 text-white text-sm px-3 py-1.5 rounded-lg transition">
        ↺ Atualizar
      </button>
      <a href="/api/leads/export${apiKey}" class="bg-emerald-700 hover:bg-emerald-600 text-white text-sm px-3 py-1.5 rounded-lg transition">
        ⬇ CSV
      </a>
    </div>
  </div>

  <!-- KPI Cards -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6" id="kpi-cards">
    <div class="card"><div class="text-slate-400 text-xs mb-1">Total Leads</div><div class="text-3xl font-bold" id="kpi-leads">—</div></div>
    <div class="card"><div class="text-slate-400 text-xs mb-1">Leads Quentes</div><div class="text-3xl font-bold text-red-400" id="kpi-quentes">—</div></div>
    <div class="card"><div class="text-slate-400 text-xs mb-1">Conversas Ativas</div><div class="text-3xl font-bold text-blue-400" id="kpi-ativas">—</div></div>
    <div class="card"><div class="text-slate-400 text-xs mb-1">Em Handoff</div><div class="text-3xl font-bold text-yellow-400" id="kpi-handoff">—</div></div>
  </div>

  <!-- Charts -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
    <div class="card">
      <h2 class="font-semibold text-sm text-slate-300 mb-3">Leads por Segmento</h2>
      <canvas id="chart-segment" height="200"></canvas>
    </div>
    <div class="card">
      <h2 class="font-semibold text-sm text-slate-300 mb-3">Leads por Temperatura</h2>
      <canvas id="chart-temp" height="200"></canvas>
    </div>
  </div>

  <!-- Leads Table -->
  <div class="card">
    <div class="flex items-center justify-between mb-3">
      <h2 class="font-semibold text-sm text-slate-300">Leads Recentes</h2>
      <div class="flex gap-2">
        <select id="filter-segment" onchange="loadLeads()" class="bg-slate-700 text-slate-200 text-xs rounded px-2 py-1 border border-slate-600">
          <option value="">Todos segmentos</option>
          <option value="LIMPA_NOMES">Limpa Nomes</option>
          <option value="REVISAO_CONTRATUAL">Revisão Contratual</option>
          <option value="MULTAS_CNH">Multas CNH</option>
        </select>
        <select id="filter-temp" onchange="loadLeads()" class="bg-slate-700 text-slate-200 text-xs rounded px-2 py-1 border border-slate-600">
          <option value="">Todas temperaturas</option>
          <option value="quente">🔥 Quente</option>
          <option value="morno">🌡 Morno</option>
          <option value="frio">❄ Frio</option>
        </select>
      </div>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-xs text-slate-300">
        <thead>
          <tr class="text-slate-500 border-b border-slate-700">
            <th class="text-left py-2 pr-4">Nome / Contato</th>
            <th class="text-left py-2 pr-4">Segmento</th>
            <th class="text-left py-2 pr-4">Necessidade</th>
            <th class="text-left py-2 pr-4">Temp.</th>
            <th class="text-left py-2 pr-4">Canal</th>
            <th class="text-left py-2">Data</th>
          </tr>
        </thead>
        <tbody id="leads-tbody">
          <tr><td colspan="6" class="py-6 text-center text-slate-500">Carregando...</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>

<script>
const KEY = '${apiKey}';
const API = '/api';

let segChart, tempChart;

const segColors  = ['#3b82f6','#22c55e','#a855f7'];
const tempColors = ['#ef4444','#f59e0b','#64748b'];
const segLabels  = { LIMPA_NOMES:'Limpa Nomes', REVISAO_CONTRATUAL:'Revisão Contratual', MULTAS_CNH:'Multas CNH' };
const tempBadge  = { quente:'badge-quente', morno:'badge-morno', frio:'badge-frio' };
const segBadge   = { LIMPA_NOMES:'badge-limpa', REVISAO_CONTRATUAL:'badge-revisao', MULTAS_CNH:'badge-multa' };

function fmt(dt) {
  if (!dt) return '—';
  const d = new Date(dt.replace(' ','T')+'Z');
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}

async function fetchJson(path) {
  const r = await fetch(API + path + KEY);
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

async function loadStats() {
  const d = await fetchJson('/stats');
  document.getElementById('kpi-leads').textContent   = d.leads.total ?? '—';
  document.getElementById('kpi-ativas').textContent  = d.conversations.active ?? '—';
  document.getElementById('kpi-handoff').textContent = d.conversations.handoff ?? '—';

  const quentes = (d.leads.byTemperatura || []).find(t => t.temperatura === 'quente');
  document.getElementById('kpi-quentes').textContent = quentes ? quentes.total : '0';

  // Chart segmento
  const segData = { LIMPA_NOMES:0, REVISAO_CONTRATUAL:0, MULTAS_CNH:0 };
  (d.leads.bySegment || []).forEach(s => { if (segData[s.segment] !== undefined) segData[s.segment] = s.total; });

  if (segChart) segChart.destroy();
  segChart = new Chart(document.getElementById('chart-segment'), {
    type: 'doughnut',
    data: {
      labels: Object.values(segLabels),
      datasets: [{ data: Object.values(segData), backgroundColor: segColors, borderWidth:0 }]
    },
    options: { plugins: { legend: { labels: { color:'#94a3b8', font:{size:11} } } } }
  });

  // Chart temperatura
  const tempData = { quente:0, morno:0, frio:0 };
  (d.leads.byTemperatura || []).forEach(t => { if (tempData[t.temperatura] !== undefined) tempData[t.temperatura] = t.total; });

  if (tempChart) tempChart.destroy();
  tempChart = new Chart(document.getElementById('chart-temp'), {
    type: 'bar',
    data: {
      labels: ['🔥 Quente','🌡 Morno','❄ Frio'],
      datasets: [{ data: Object.values(tempData), backgroundColor: tempColors, borderRadius:6 }]
    },
    options: {
      plugins: { legend: { display:false } },
      scales: { x: { ticks:{color:'#94a3b8'}, grid:{color:'#1e293b'} }, y: { ticks:{color:'#94a3b8'}, grid:{color:'#334155'} } }
    }
  });
}

async function loadLeads() {
  const seg  = document.getElementById('filter-segment').value;
  const temp = document.getElementById('filter-temp').value;
  let qs = KEY;
  if (seg)  qs += (qs?'&':'?') + 'segment=' + seg;
  if (temp) qs += (qs?'&':'?') + 'temperatura=' + temp;

  const d = await fetchJson('/leads' + (qs ? (qs.startsWith('?')?qs:'?'+qs.slice(1)) : ''));
  const tbody = document.getElementById('leads-tbody');

  if (!d.leads || d.leads.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="py-6 text-center text-slate-500">Nenhum lead encontrado</td></tr>';
    return;
  }

  tbody.innerHTML = d.leads.map(l => \`
    <tr class="border-b border-slate-800 cursor-default">
      <td class="py-2 pr-4">
        <div class="font-medium text-white">\${l.nome || l.channel_id}</div>
        \${l.telefone ? '<div class="text-slate-500">'+l.telefone+'</div>' : ''}
      </td>
      <td class="py-2 pr-4"><span class="tag \${segBadge[l.segment]||''}">\${segLabels[l.segment]||l.segment}</span></td>
      <td class="py-2 pr-4 text-slate-400 max-w-xs truncate">\${l.necessidade||'—'}</td>
      <td class="py-2 pr-4"><span class="tag \${tempBadge[l.temperatura]||''}">\${l.temperatura}</span></td>
      <td class="py-2 pr-4 text-slate-500">\${l.channel}</td>
      <td class="py-2 text-slate-500">\${fmt(l.created_at)}</td>
    </tr>
  \`).join('');
}

async function loadAll() {
  try {
    await Promise.all([loadStats(), loadLeads()]);
    document.getElementById('last-update').textContent = 'Atualizado: ' + new Date().toLocaleTimeString('pt-BR');
  } catch(e) {
    console.error(e);
  }
}

loadAll();
setInterval(loadAll, 30000); // auto-refresh a cada 30s
</script>
</body></html>`;
}

module.exports = { router };
