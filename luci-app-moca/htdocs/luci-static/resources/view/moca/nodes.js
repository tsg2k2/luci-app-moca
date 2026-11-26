'use strict';
'require view';
'require ui';
'require rpc';
'require poll';
'require moca.phy as phy';

/*
 * Coax nodes — the whole MoCA network as seen by the router's own chip over
 * L2ME (rpcd object "moca", census method).  One row per node: role, GUID,
 * MoCA version, PHY rates.  Every node can be driven through the L2ME command
 * console (Details); a node whose GUID matches a configured adapter also gets
 * a "Manage (web)" link to that adapter's HTTP control on the Adapters tab.
 */

var callCensus = rpc.declare({ object: 'moca', method: 'census', expect: {} });
var callNodeReset = rpc.declare({ object: 'moca', method: 'node_reset',
	params: [ 'nodemask', 'seconds' ], expect: {} });
var callNodeCmd = rpc.declare({ object: 'moca', method: 'node_cmd',
	params: [ 'cmd' ], expect: {} });
var callList = rpc.declare({ object: 'moca', method: 'list', expect: { adapters: [] } });

/* ---- per-node L2ME command console -------------------------------------- */
function mwHex(n) { return '0x' + (n >>> 0).toString(16); }
function mwWords(a) {
	return a.map(function(x) { return '0x' + ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join(' ');
}
function mocaParse(r) {
	if (!r || !r.resp) return { err: (r && r.error) || _('no response') };
	var p = String(r.resp).trim().split(/\s+/);
	return { bytes: parseInt(p[0], 10) || 0,
		 words: p.slice(1).map(function(x) { return parseInt(x, 16) >>> 0; }) };
}
function decMac2(hi, lo) {
	function b(v, s) { return ('0' + ((v >>> s) & 0xff).toString(16)).slice(-2); }
	return [ b(hi,24), b(hi,16), b(hi,8), b(hi,0), b(lo,24), b(lo,16) ].join(':');
}
function decNetInfo(w) {
	if (w.length < 5) return '';
	return 'GUID ' + decMac2(w[0], w[1]) + '   MoCA ' + ((w[4] >> 4) & 0xf) + '.' + (w[4] & 0xf);
}
function decBeacon(w) { return (w.length >= 2) ? ('power=' + w[0] + '  backoff=' + w[1]) : ''; }
function decPhyNode(w) {
	if (w.length < 5 || !w[0]) return '';
	return 'freq offset=' + phy.s32(w[1]) + '  prop delay=' + phy.s32(w[3]) +
		'  TX profiles=0x' + w[4].toString(16);
}
function decTxProf(w) {
	var t = phy.decTx(w);
	return t ? ('rate=' + Math.round(t.rate / 1e6) + ' Mbit/s  TX power=' + t.power + ' dBm (-' + t.reduction + ' dB)') : '';
}
function decRxProf(w) {
	var r = phy.decRx(w);
	return r ? ('rate=' + Math.round(r.rate / 1e6) + ' Mbit/s  RX power=' + r.power + ' dBm  SNR=' + r.snr + ' dB') : '';
}
function decPhyMisc(w) { return (w.length >= 2) ? ('beacon channel ' + w[1] + ' MHz') : ''; }
/* Frame stats: 6 blocks (TX, TX err, ?, RX, RX err, RX dropped) of 9 u64 counters
 * (MAP, RR, LCF, beacon, ACF, probe, Eth, OFDMA RR, OFDMA EVM). */
function decFrames(w) {
	if (w.length < 108) return '';
	function c(k, t) { return phy.u64(w, 2 * (9 * k + t)); }
	function tot(k) { var s = 0; for (var t = 0; t < 9; t++) s += c(k, t); return s; }
	return 'TX=' + tot(0) + ' err=' + tot(1) + ' | RX=' + tot(3) + ' err=' + tot(4) + ' dropped=' + tot(5);
}
function decMacData(w) {
	var out = [];
	for (var n = 0; n < 16 && n < w.length; n++) if (w[n]) out.push('n' + n + '=' + w[n]);
	return 'TX packets per node: ' + (out.length ? out.join(' ') : 'none');
}
/* Aggregation histograms: word i = frames carrying i+1 packets, TX 0..159, RX 160..319. */
function decAggr(w) {
	if (w.length < 320) return '';
	var tf = 0, tp = 0, rf = 0, rp = 0;
	for (var i = 0; i < 160; i++) { tf += w[i]; tp += (i + 1) * w[i]; rf += w[160 + i]; rp += (i + 1) * w[160 + i]; }
	return 'TX ' + tp + ' pkts in ' + tf + ' frames | RX ' + rp + ' pkts in ' + rf + ' frames';
}
function decWord0(w) { return (w.length >= 1) ? ('= ' + w[0] + ' (0x' + w[0].toString(16) + ')') : ''; }
function decSoc(w) {
	if (w.length < 6) return '';
	return (w[0] === 1 ? 'healthy' : 'UNHEALTHY') + '  fatal=0x' + w[1].toString(16) +
		'  bbTemp=' + w[4] + 'C  rfTemp=' + w[5] + 'C';
}
/* 64-bit counter: word[i] = high half, word[i+1] = low half (per the OEM decode) */
function u64(w, i) { return (i + 1 < w.length) ? (w[i] * 4294967296 + w[i + 1]) : 0; }

function decDataStats(w) {
	if (w.length < 148) return '';
	return 'TX pkt=' + u64(w, 0) + ' byte=' + u64(w, 2) + ' drop=' + u64(w, 4) +
		' | RX pkt=' + u64(w, 142) + ' byte=' + u64(w, 144) + ' drop=' + u64(w, 146);
}
function decL2me(w) {
	if (w.length < 4) return '';
	return 'issued=' + w[0] + ' ok=' + w[1] + ' timedout=' + w[2] + ' failed=' + w[3];
}
function decSec(w) {
	if (w.length < 9) return '';
	return 'clear=' + w[0] + ' MMK=' + w[2] + ' PMK=' + w[3] + ' TEK=' + w[4] +
		'  (auth: MMK=' + w[6] + ' PMK=' + w[7] + ' TEK=' + w[8] + ')';
}
function decFrag(w) { return 'rx=' + (w[0] || 0) + '  tx=' + (w[1] || 0); }
function decEcb(w) {
	if (w.length < 18) return '';
	return 'MoCA TXdrop=' + w[8] + ' RXunclass=' + w[9] +
		' SGMII0(rxbad=' + w[10] + ' txdma=' + w[11] + ')' +
		' RxAPDUcrc=' + (w[15] || 0) + ' RxPDUcrc=' + (w[16] || 0) + ' TxDrop=' + (w[17] || 0);
}
function decEphy(w) {
	if (w.length < 12) return '';
	return 'in=' + w[2] + ' out=' + w[8] + ' dropped=' + w[10];
}
function decRetx(w) {
	var out = [];
	for (var n = 0; n < 16 && (n * 2 + 1) < w.length; n++)
		if (w[n*2] || w[n*2+1]) out.push('n' + n + '(retx=' + w[n*2] + ' to=' + w[n*2+1] + ')');
	return out.length ? out.join(' ') : 'none';
}

var MOCA_GROUPS = {
	phy: _('PHY / link'), stats: _('Statistics'), power: _('Power'),
	manage: _('Management'), security: _('Security'), bridge: _('Switch / bridge')
};

var MOCA_CMDS = [
	{ g: 'phy', ov: 1, name: _('Net info'),  d: decNetInfo, b: function(n) { return ['0x1010016', mwHex(n)]; } },
	{ g: 'phy', ov: 1, name: _('PHY node'),  d: decPhyNode, b: function(n) { return ['0x1010022', mwHex(n)]; } },
	{ g: 'phy', ov: 1, name: _('FMR rates'), b: function(n) { return ['0x101001d', mwHex(1 << n), '0x2']; } },
	{ g: 'phy', name: _('PHY misc'),   d: decPhyMisc, b: function() { return ['0x1010024']; } },
	{ g: 'phy', ov: 1, name: _('Tx profile'), d: decTxProf, b: function(n) { return ['0x1010020', mwHex(n), '0x21', '0x0']; } },
	{ g: 'phy', ov: 1, name: _('Rx profile'), d: decRxProf, b: function(n) { return ['0x1010021', mwHex(n), '0x21', '0x0']; } },
	{ g: 'stats', ov: 1, name: _('Data stats'), d: decDataStats, b: function(n) { return ['0x101000b', mwHex(n)]; } },
	{ g: 'stats', ov: 1, name: _('L2ME stats'), d: decL2me, b: function() { return ['0x1010056', '0x0']; } },
	{ g: 'stats', name: _('MAC data stats'), d: decMacData, b: function() { return ['0x101007e', '0x0']; } },
	{ g: 'stats', name: _('Aggregate stats'), d: decAggr, b: function() { return ['0x1010010', '0x0']; } },
	{ g: 'stats', name: _('Frame stats'), d: decFrames, b: function() { return ['0x1010014', '0x0']; } },
	{ g: 'stats', name: _('Retransmit stats'),  d: decRetx, b: function() { return ['0x1010026', '0x0']; } },
	{ g: 'stats', name: _('Fragmentation stats'), d: decFrag, b: function() { return ['0x1010054', '0x0']; } },
	{ g: 'stats', name: _('ECB stats'),         d: decEcb, b: function() { return ['0x1010093', '0x0']; } },
	{ g: 'stats', name: _('ePHY stats'), d: decEphy, b: function() { return ['0x1010013', '0x0']; } },
	{ g: 'power', ov: 1, name: _('Beacon power'), d: decBeacon, b: function() { return ['0x1010009']; } },
	{ g: 'power', name: _('Set beacon power'), danger: 1,
	  i: [ { k: 'p', l: _('Power'), def: '10' }, { k: 'q', l: _('Backoff'), def: '0' } ],
	  b: function(n, v) { return ['0x1010008', mwHex(+v.p), mwHex(+v.q)]; } },
	{ g: 'power', name: _('Power-mode caps'),  d: decWord0, b: function() { return ['0x1010032']; } },
	{ g: 'power', name: _('Power-mode state'), d: decWord0, b: function(n) { return ['0x1010033', mwHex(n)]; } },
	{ g: 'power', name: _('MPS state'),        d: decWord0, b: function() { return ['0x1010092']; } },
	{ g: 'power', name: _('Sleep'), danger: 1, i: [ { k: 'd', l: _('State (1-3)'), def: '1' } ],
	  b: function(n, v) { return ['0x1010030', mwHex(+v.d)]; } },
	{ g: 'power', name: _('Wake'),             b: function() { return ['0x1010031', '0x0']; } },
	{ g: 'manage', ov: 1, name: _('SoC status'), d: decSoc, b: function() { return ['0x1010001']; } },
	{ g: 'manage', name: _('Reset node'), danger: 1, special: 'reset', i: [ { k: 's', l: _('Delay s'), def: '0' } ] },
	{ g: 'manage', name: _('Request NC handoff'), danger: 1, b: function(n) { return ['0x1010019', mwHex(n), '0x0']; } },
	{ g: 'manage', name: _('Request NMS'), danger: 1, b: function(n) { return ['0x101001b', mwHex(n)]; } },
	{ g: 'security', name: _('Security stats'), d: decSec, b: function() { return ['0x1010052', '0x0']; } },
	{ g: 'security', name: _('Enhanced security'), b: function() { return ['0x101005f']; } },
	{ g: 'security', name: _('Energy detect'),   b: function() { return ['0x1010059']; } },
	{ g: 'bridge', name: _('Switch table'),  b: function(n) { return ['0x1010071', mwHex(n), '0x0']; } },
	{ g: 'bridge', name: _('Switch stats'),  b: function() { return ['0x1010072', '0x0']; } },
	{ g: 'bridge', name: _('Switch config'), b: function(n) { return ['0x1010073', mwHex(n)]; } },
	{ g: 'bridge', name: _('Bridge stats'),  b: function() { return ['0x1010011', '0x0']; } },
	{ g: 'bridge', name: _('Bridge table'),  b: function(n) { return ['0x1010012', mwHex(n), '0x0']; } },
	{ g: 'bridge', name: _('Mcast filter mode'), d: decWord0, b: function() { return ['0x1010027']; } },
	{ g: 'bridge', name: _('List QoS flows'), b: function() { return ['0x1010043', '0x0', '0x0', '0x0', '0x0']; } }
];

function mocaRun(c, node, vals) {
	if (c.special === 'reset')
		return callNodeReset('0x' + (1 << node).toString(16), (vals && vals.s) || '0').then(function(r) {
			return (r && r.ok) ? _('reset issued') : (_('error: ') + ((r && r.error) || '?'));
		});
	return callNodeCmd(c.b(node, vals || {}).join(' ')).then(function(r) {
		var p = mocaParse(r);
		if (p.err) return _('error: ') + p.err;
		var dec = c.d ? c.d(p.words) : (p.words.length === 1 ? decWord0(p.words) : '');
		return (dec ? dec + '   ' : '') + '[' + p.bytes + 'B] ' + mwWords(p.words);
	});
}

/* Bit loading of one channel as an SVG column chart, 0..10 bits. */
function bitChart(bits, title) {
	var W = 512, H = 80, ns = 'http://www.w3.org/2000/svg';
	var svg = document.createElementNS(ns, 'svg');
	svg.setAttribute('viewBox', '0 0 ' + W + ' ' + (H + 2));
	svg.setAttribute('preserveAspectRatio', 'none');
	svg.setAttribute('style', 'width:100%;height:90px;display:block;color:var(--primary-color-high, #3b7dd8)');
	[ 2, 4, 6, 8, 10 ].forEach(function(b) {
		var y = H - b * H / 10;
		var l = document.createElementNS(ns, 'line');
		l.setAttribute('x1', 0); l.setAttribute('x2', W); l.setAttribute('y1', y); l.setAttribute('y2', y);
		l.setAttribute('stroke', 'currentColor'); l.setAttribute('stroke-opacity', '0.15');
		l.setAttribute('stroke-width', '0.5'); l.setAttribute('vector-effect', 'non-scaling-stroke');
		svg.appendChild(l);
	});
	var d = '';
	bits.forEach(function(b, i) { if (b) d += 'M' + i + ' ' + H + 'v-' + (b * H / 10) + 'h1v' + (b * H / 10) + 'z'; });
	var p = document.createElementNS(ns, 'path');
	p.setAttribute('d', d); p.setAttribute('fill', 'currentColor');
	svg.appendChild(p);
	var used = bits.filter(function(b) { return b; });
	var avg = used.length ? (used.reduce(function(a, b) { return a + b; }, 0) / used.length).toFixed(1) : '0';
	return E('div', { 'style': 'margin:.6em 0' }, [
		E('div', { 'style': 'font-size:90%' },
			_('%s: %d of 512 subcarriers used, %s bits average').format(title, used.length, avg)),
		svg ]);
}

function mocaNodeDialog(node, guid) {
	var content = E('div');
	var tabBar = E('ul', { 'class': 'cbi-tabmenu' });
	var panes = {}, links = {};

	function addTab(key, label) {
		var pane = E('div', { 'style': 'display:none' });
		panes[key] = pane;
		content.appendChild(pane);
		var a = E('a', { 'href': '#' }, label);
		var li = E('li', {}, a);
		links[key] = li;
		a.addEventListener('click', function(ev) {
			ev.preventDefault();
			Object.keys(panes).forEach(function(k) {
				panes[k].style.display = (k === key) ? '' : 'none';
				links[k].classList.toggle('cbi-tab', k === key);
			});
		});
		tabBar.appendChild(li);
	}

	addTab('ov', _('Overview'));
	var ovTbl = E('table', { 'class': 'table' });
	function loadOv() {
		ovTbl.innerHTML = '';
		MOCA_CMDS.filter(function(c) { return c.ov; }).forEach(function(c) {
			var v = E('td', { 'class': 'td', 'style': 'font-family:monospace;word-break:break-all' }, '…');
			ovTbl.appendChild(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left', 'width': '24%' }, c.name), v ]));
			mocaRun(c, node, {}).then(function(s) { v.textContent = s; });
		});
	}
	var refetch = E('button', { 'class': 'cbi-button cbi-button-action' }, _('Re-fetch'));
	refetch.addEventListener('click', loadOv);
	panes.ov.appendChild(E('div', {}, [ refetch, ovTbl ]));

	var byg = {};
	MOCA_CMDS.forEach(function(c) { (byg[c.g] = byg[c.g] || []).push(c); });
	Object.keys(MOCA_GROUPS).forEach(function(g) {
		addTab(g, MOCA_GROUPS[g]);
		var tbl = E('table', { 'class': 'table' });
		(byg[g] || []).forEach(function(c) {
			var inputs = {}, ctrls = [];
			(c.i || []).forEach(function(inp) {
				var el = E('input', { 'type': 'text', 'class': 'cbi-input-text',
					'style': 'width:5em', 'value': inp.def || '' });
				inputs[inp.k] = el;
				ctrls.push(E('span', { 'style': 'margin-right:.6em' }, [ inp.l + ' ', el ]));
			});
			var out = E('span', { 'style': 'font-family:monospace;margin-left:.5em;word-break:break-all' });
			var btn = E('button', { 'class': 'cbi-button ' +
				(c.danger ? 'cbi-button-negative' : 'cbi-button-action'),
				'style': 'min-width:11em' }, c.name);
			btn.addEventListener('click', function() {
				var vals = {};
				Object.keys(inputs).forEach(function(k) { vals[k] = inputs[k].value; });
				out.textContent = '…';
				mocaRun(c, node, vals).then(function(s) { out.textContent = s; });
			});
			tbl.appendChild(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'white-space:nowrap' }, [ btn ]),
				E('td', { 'class': 'td' }, ctrls.concat([ out ]))
			]));
		});
		panes[g].appendChild(tbl);
	});

	addTab('bits', _('Bit loading'));
	var bitsOut = E('div');
	function loadBits(dir) {
		bitsOut.innerHTML = '';
		bitsOut.appendChild(E('em', {}, _('Reading…')));
		phy.linkBitLoading(node, dir, 5).then(function(chs) {
			bitsOut.innerHTML = '';
			var any = false;
			chs.forEach(function(bits, ch) {
				if (!bits) return;
				any = true;
				bitsOut.appendChild(bitChart(bits, _('Channel %d').format(ch)));
			});
			if (!any)
				bitsOut.appendChild(E('em', {}, _('No profile for this link (this router, or the node is not admitted).')));
		});
	}
	var bitsRx = E('button', { 'class': 'cbi-button cbi-button-action' }, _('RX from this node'));
	var bitsTx = E('button', { 'class': 'cbi-button cbi-button-action', 'style': 'margin-left:.4em' }, _('TX to this node'));
	bitsRx.addEventListener('click', function() { loadBits('rx'); });
	bitsTx.addEventListener('click', function() { loadBits('tx'); });
	panes.bits.appendChild(E('div', {}, [
		E('p', { 'class': 'cbi-value-description' },
			_('Bits per subcarrier on each 100 MHz channel (512 subcarriers, up to 10 bits). Gaps at 0 are ' +
			  'unused or notched subcarriers; a dip across many subcarriers points at noise or a reflection ' +
			  'at those frequencies.')),
		bitsRx, bitsTx, bitsOut ]));

	addTab('raw', _('Raw command'));
	var rin = E('input', { 'type': 'text', 'class': 'cbi-input-text',
		'style': 'width:24em', 'placeholder': '0x1010022 ' + mwHex(node) });
	var rout = E('span', { 'style': 'font-family:monospace;margin-left:.5em;word-break:break-all' });
	var rbtn = E('button', { 'class': 'cbi-button cbi-button-action' }, _('Send'));
	rbtn.addEventListener('click', function() {
		var v = (rin.value || '').trim();
		if (!v) return;
		rout.textContent = '…';
		callNodeCmd(v).then(function(r) { rout.textContent = (r && r.resp) || (r && r.error) || '?'; });
	});
	panes.raw.appendChild(E('div', {}, [
		E('p', { 'class': 'cbi-value-description' },
			_('Send a raw "<cmdid> [hex words]" to the SoC (the node id is usually word 0).')),
		rin, ' ', rbtn, rout ]));

	var closeBtn = E('button', { 'class': 'cbi-button' }, _('Close'));
	closeBtn.addEventListener('click', ui.hideModal);

	ui.showModal(_('Node %d — %s').format(node, guid || ''), [
		tabBar, content, E('div', { 'class': 'right' }, [ closeBtn ])
	]);

	panes.ov.style.display = '';
	links.ov.classList.add('cbi-tab');
	loadOv();
}

return view.extend({
	load: function() {
		return Promise.all([
			callCensus().catch(function() { return {}; }),
			callList().catch(function() { return []; })
		]);
	},

	render: function(data) {
		var adapters = data[1] || [];
		var byMac = {};
		adapters.forEach(function(a) { if (a.mac) byMac[a.mac.toLowerCase()] = a; });

		var body = E('div');

		function loadCoax(quiet) {
			if (!quiet || !body.firstChild) {
				body.innerHTML = '';
				body.appendChild(E('em', {}, _('Reading coax node table…')));
			}
			return callCensus().then(function(c) {
				var nodes = (c && c.nodes) || [];
				var self = parseInt(c && c.self, 10);
				var ncId = parseInt(c && c.nc, 10);
				body.innerHTML = '';
				if (!nodes.length) {
					body.appendChild(E('p', { 'class': 'cbi-value-description' },
						_('No local MoCA chip reported (is this the CR1000A?).')));
					return;
				}
				var tbl = E('table', { 'class': 'table' }, [
					E('tr', { 'class': 'tr table-titles' }, [
						E('th', { 'class': 'th' }, _('Node')),
						E('th', { 'class': 'th' }, _('Role')),
						E('th', { 'class': 'th' }, _('MoCA')),
						E('th', { 'class': 'th' }, _('TX/RX Mbps')),
						E('th', { 'class': 'th' }, _('GUID')),
						E('th', { 'class': 'th' }, _('Device')),
						E('th', { 'class': 'th' }, _('Actions'))
					])
				]);
				nodes.forEach(function(n) {
					var id = parseInt(n.node, 10);
					var cell = [];
					var adapter = n.guid ? byMac[String(n.guid).toLowerCase()] : null;

					var ctl = E('button', { 'class': 'cbi-button cbi-button-action',
						'style': 'margin-right:.4em' }, _('Details'));
					ctl.addEventListener('click', function() { mocaNodeDialog(id, n.guid); });
					cell.push(ctl);
					if (adapter)
						cell.push(E('a', {
							'class': 'cbi-button cbi-button-neutral',
							'href': L.url('admin/network/moca/adapters'),
							'title': adapter.name + ' @ ' + adapter.host
						}, _('Manage (web)')));

					/* device behind the node: adapter name, else DHCP host/ip */
					var devName = adapter ? adapter.name
						: (n.host || (id === self ? _('this router') : ''));
					var devCell = [ E('span', {}, devName || '–') ];
					if (n.ip) devCell.push(E('span', { 'style': 'color:#888' }, ' (' + n.ip + ')'));

					tbl.appendChild(E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td' }, String(id)),
						E('td', { 'class': 'td' }, n.role + (id === ncId ? ' ★' : '')),
						E('td', { 'class': 'td' }, n.moca),
						E('td', { 'class': 'td' }, (n.tx || '0') + '/' + (n.rx || '0')),
						E('td', { 'class': 'td', 'style': 'font-family:monospace' }, n.guid),
						E('td', { 'class': 'td' }, devCell),
						E('td', { 'class': 'td' }, cell)
					]));
				});
				body.appendChild(tbl);
			}).catch(function(e) {
				body.innerHTML = '';
				body.appendChild(E('p', { 'class': 'alert-message warning' },
					_('Census failed: ') + (e.message || e)));
			});
		}

		var refreshBtn = E('button', { 'class': 'cbi-button cbi-button-action' }, _('Refresh'));
		refreshBtn.addEventListener('click', loadCoax);

		var cmdIn = E('input', { 'type': 'text', 'class': 'cbi-input-text',
			'style': 'width:24em', 'placeholder': '0x1010022 0x00000001' });
		var cmdOut = E('span', { 'style': 'margin-left:.5em;font-family:monospace;word-break:break-all' });
		var cmdBtn = E('button', { 'class': 'cbi-button cbi-button-action' }, _('Send'));
		cmdBtn.addEventListener('click', function() {
			var v = (cmdIn.value || '').trim();
			if (!v) return;
			cmdOut.textContent = '…';
			callNodeCmd(v).then(function(r) {
				cmdOut.textContent = (r && r.resp) ? r.resp : (_('error: ') + ((r && r.error) || '?'));
			});
		});

		/* ---- full per-node PHY-rate matrix (FMR per node) ---- */
		function fmrRow(words) {
			var b = [];
			words.forEach(function(w) { b.push((w>>>24)&0xff, (w>>>16)&0xff, (w>>>8)&0xff, w&0xff); });
			var rates = [];
			for (var p = 0; p < 16; p++) {
				var dp = 0x28 + p * 6;
				if (dp + 4 > b.length) break;
				var cp = b[dp], nbits = (b[dp+2] << 8) | b[dp+3];
				rates[p] = nbits ? Math.floor(nbits * 1200 / ((cp + 138) * 52)) : 0;
			}
			return rates;
		}
		var matrixBody = E('div');
		function loadMatrix() {
			matrixBody.innerHTML = '';
			matrixBody.appendChild(E('em', {}, _('Building rate matrix…')));
			callCensus().then(function(c) {
				var ns = (c && c.nodes || []).map(function(n) { return parseInt(n.node, 10); });
				return Promise.all(ns.map(function(n) {
					return callNodeCmd('0x101001d 0x' + (1 << n).toString(16) + ' 0x2').then(function(r) {
						var p = mocaParse(r);
						return { node: n, rates: p.words ? fmrRow(p.words) : [] };
					});
				})).then(function(rows) {
					var hdr = [ E('th', { 'class': 'th' }, _('TX\\RX')) ];
					ns.forEach(function(n) { hdr.push(E('th', { 'class': 'th' }, _('node %d').format(n))); });
					var tbl = E('table', { 'class': 'table' }, [ E('tr', { 'class': 'tr table-titles' }, hdr) ]);
					rows.forEach(function(row) {
						var cells = [ E('td', { 'class': 'td', 'style': 'font-weight:bold' }, _('node %d').format(row.node)) ];
						ns.forEach(function(to) {
							cells.push(E('td', { 'class': 'td' },
								(row.node === to) ? '—' : String(row.rates[to] || 0)));
						});
						tbl.appendChild(E('tr', { 'class': 'tr' }, cells));
					});
					matrixBody.innerHTML = '';
					matrixBody.appendChild(tbl);
				});
			}).catch(function(e) {
				matrixBody.innerHTML = '';
				matrixBody.appendChild(E('p', { 'class': 'alert-message warning' },
					_('Matrix failed: ') + (e.message || e)));
			});
		}
		var matrixBtn = E('button', { 'class': 'cbi-button cbi-button-action' }, _('Show rate matrix'));
		matrixBtn.addEventListener('click', loadMatrix);

		loadCoax();
		poll.add(function() { return loadCoax(true); }, 8);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('Coax nodes (MoCA L2ME)')),
			E('div', { 'class': 'cbi-section' }, [
				E('p', { 'class': 'cbi-value-description' },
					_('Every node on the coax as seen by the router\'s own MoCA chip — by ' +
					  'GUID, no IP needed. Use Details for the per-node command console; a ' +
					  'node matching a configured adapter also links to its web management.')),
				refreshBtn, body,
				E('h3', {}, _('Per-node PHY-rate matrix (Mbps)')),
				E('p', { 'class': 'cbi-value-description' },
					_('Row = transmitting node, column = receiving node.')),
				matrixBtn, matrixBody,
				E('h3', {}, _('L2ME command (advanced)')),
				E('p', { 'class': 'cbi-value-description' },
					_('Raw SoC command "<cmdid> [hex words]" — e.g. 0x1010022 0x1 = ' +
					  'per-node PHY for node 1; 0x1010009 = beacon power.')),
				cmdIn, ' ', cmdBtn, cmdOut
			])
		]);
	}
});
