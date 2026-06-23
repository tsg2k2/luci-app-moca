'use strict';
'require view';
'require ui';
'require rpc';

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
	function s32(x) { return (x >>> 31) ? (x - 0x100000000) : x; }
	if (w.length < 5) return '';
	return 'valid=' + w[0] + '  vals=[' + s32(w[1]) + ', ' + s32(w[2]) + ', ' + s32(w[3]) + ', ' + s32(w[4]) + ']';
}
function decWord0(w) { return (w.length >= 1) ? ('= ' + w[0] + ' (0x' + w[0].toString(16) + ')') : ''; }

var MOCA_GROUPS = {
	phy: _('PHY / link'), stats: _('Statistics'), power: _('Power'),
	manage: _('Management'), security: _('Security'), bridge: _('Switch / bridge')
};

var MOCA_CMDS = [
	{ g: 'phy', ov: 1, name: _('Net info'),  d: decNetInfo, b: function(n) { return ['0x1010016', mwHex(n)]; } },
	{ g: 'phy', ov: 1, name: _('PHY node'),  d: decPhyNode, b: function(n) { return ['0x1010022', mwHex(n)]; } },
	{ g: 'phy', ov: 1, name: _('FMR rates'), b: function(n) { return ['0x101001d', mwHex(1 << n), '0x2']; } },
	{ g: 'phy', name: _('PHY EVM / SNR'),    b: function(n) { return ['0x1010023', mwHex(n), '0x0']; } },
	{ g: 'phy', name: _('PHY misc'),         b: function() { return ['0x1010024']; } },
	{ g: 'phy', name: _('Tx profile'),       b: function(n) { return ['0x1010020', mwHex(n), '0x0', '0x0']; } },
	{ g: 'phy', name: _('Rx profile'),       b: function(n) { return ['0x1010021', mwHex(n), '0x0', '0x0']; } },
	{ g: 'phy', name: _('Spectrum'),         b: function(n) { return ['0x101001c', mwHex(n)]; } },
	{ g: 'stats', ov: 1, name: _('Data stats'), b: function(n) { return ['0x101000b', mwHex(n)]; } },
	{ g: 'stats', ov: 1, name: _('L2ME stats'), b: function(n) { return ['0x1010056', mwHex(n)]; } },
	{ g: 'stats', name: _('MAC data stats'),    b: function(n) { return ['0x101007e', mwHex(n)]; } },
	{ g: 'stats', name: _('Aggregate stats'),   b: function(n) { return ['0x1010010', mwHex(n)]; } },
	{ g: 'stats', name: _('Frame stats'),       b: function(n) { return ['0x1010014', mwHex(n)]; } },
	{ g: 'stats', name: _('Retransmit stats'),  b: function(n) { return ['0x1010026', mwHex(n)]; } },
	{ g: 'stats', name: _('Fragmentation stats'), b: function(n) { return ['0x1010054', mwHex(n)]; } },
	{ g: 'stats', name: _('ECB stats'),         b: function(n) { return ['0x1010093', mwHex(n)]; } },
	{ g: 'stats', name: _('ePHY stats'),        b: function(n) { return ['0x1010013', mwHex(n)]; } },
	{ g: 'power', ov: 1, name: _('Beacon power'), d: decBeacon, b: function() { return ['0x1010009']; } },
	{ g: 'power', name: _('Set beacon power'), danger: 1,
	  i: [ { k: 'p', l: _('Power'), def: '10' }, { k: 'q', l: _('Backoff'), def: '0' } ],
	  b: function(n, v) { return ['0x1010008', mwHex(+v.p), mwHex(+v.q)]; } },
	{ g: 'power', name: _('Power-mode caps'),  d: decWord0, b: function() { return ['0x1010032']; } },
	{ g: 'power', name: _('Power-mode state'), d: decWord0, b: function(n) { return ['0x1010033', mwHex(n)]; } },
	{ g: 'power', name: _('MPS state'),        d: decWord0, b: function() { return ['0x1010092']; } },
	{ g: 'power', name: _('Sleep'), danger: 1, i: [ { k: 'd', l: _('Duration'), def: '0' } ],
	  b: function(n, v) { return ['0x1010030', mwHex(+v.d)]; } },
	{ g: 'power', name: _('Wake'),             b: function() { return ['0x1010031', '0x0']; } },
	{ g: 'manage', name: _('Reset node'), danger: 1, special: 'reset', i: [ { k: 's', l: _('Delay s'), def: '0' } ] },
	{ g: 'manage', name: _('Request NC handoff'), danger: 1, b: function(n) { return ['0x1010019', mwHex(1 << n), '0x0']; } },
	{ g: 'manage', name: _('Request LMO'), danger: 1, b: function(n) { return ['0x101001a', mwHex(1 << n), '0x0', '0x0', '0x0', '0x0']; } },
	{ g: 'manage', name: _('Request NMS'), danger: 1, b: function(n) { return ['0x101001b', mwHex(n)]; } },
	{ g: 'security', ov: 1, name: _('Security info'), b: function() { return ['0x1010051']; } },
	{ g: 'security', name: _('Security stats'),    b: function(n) { return ['0x1010052', mwHex(n)]; } },
	{ g: 'security', name: _('Enhanced security'), b: function() { return ['0x101005f']; } },
	{ g: 'security', name: _('Endpoint detect'),   b: function() { return ['0x1010059']; } },
	{ g: 'bridge', name: _('Switch table'),  b: function(n) { return ['0x1010071', mwHex(n), '0x0']; } },
	{ g: 'bridge', name: _('Switch stats'),  b: function(n) { return ['0x1010072', mwHex(n)]; } },
	{ g: 'bridge', name: _('Switch config'), b: function(n) { return ['0x1010073', mwHex(n)]; } },
	{ g: 'bridge', name: _('Bridge stats'),  b: function(n) { return ['0x1010011', mwHex(n)]; } },
	{ g: 'bridge', name: _('Bridge table'),  b: function(n) { return ['0x1010012', mwHex(n), '0x0']; } }
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

		function loadCoax() {
			body.innerHTML = '';
			body.appendChild(E('em', {}, _('Reading coax node table…')));
			callCensus().then(function(c) {
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
						E('th', { 'class': 'th' }, _('Actions'))
					])
				]);
				nodes.forEach(function(n) {
					var id = parseInt(n.node, 10);
					var cell = [];

					var ctl = E('button', { 'class': 'cbi-button cbi-button-action',
						'style': 'margin-right:.4em' }, _('Details'));
					ctl.addEventListener('click', function() { mocaNodeDialog(id, n.guid); });
					cell.push(ctl);

					var adapter = n.guid ? byMac[String(n.guid).toLowerCase()] : null;
					if (adapter)
						cell.push(E('a', {
							'class': 'cbi-button cbi-button-neutral',
							'href': L.url('admin/network/moca/adapters'),
							'title': adapter.name + ' @ ' + adapter.host
						}, _('Manage (web)')));
					if (id === self)
						cell.push(E('em', { 'style': 'margin-left:.4em' }, _('(this router)')));

					tbl.appendChild(E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td' }, String(id)),
						E('td', { 'class': 'td' }, n.role + (id === ncId ? ' ★' : '')),
						E('td', { 'class': 'td' }, n.moca),
						E('td', { 'class': 'td' }, (n.tx || '0') + '/' + (n.rx || '0')),
						E('td', { 'class': 'td', 'style': 'font-family:monospace' }, n.guid),
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

		loadCoax();

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('Coax nodes (MoCA L2ME)')),
			E('div', { 'class': 'cbi-section' }, [
				E('p', { 'class': 'cbi-value-description' },
					_('Every node on the coax as seen by the router\'s own MoCA chip — by ' +
					  'GUID, no IP needed. Use Details for the per-node command console; a ' +
					  'node matching a configured adapter also links to its web management.')),
				refreshBtn, body,
				E('h3', {}, _('L2ME command (advanced)')),
				E('p', { 'class': 'cbi-value-description' },
					_('Raw SoC/DCAP command "<cmdid> [hex words]" — e.g. 0x1010022 0x1 = ' +
					  'per-node PHY for node 1; 0x1010009 = beacon power.')),
				cmdIn, ' ', cmdBtn, cmdOut
			])
		]);
	}
});
