'use strict';
'require view';
'require form';
'require ui';
'require uci';
'require rpc';

/*
 * Adapters — manage standalone MoCA adapters (Frontier FC252/FCA251, Verizon
 * ASK-MAE340, GoCoax ...) over each adapter's HTTP /ms parameter API.  The rpcd
 * object "moca" proxies the requests using credentials in /etc/config/moca_other;
 * passwords stay on the router.  See docs/MOCA-OTHER-API.md.
 */

var callList = rpc.declare({ object: 'moca', method: 'list', expect: { adapters: [] } });
var callRequest = rpc.declare({ object: 'moca', method: 'request',
	params: [ 'id', 'path', 'body' ], expect: {} });
var callDiscover = rpc.declare({ object: 'moca', method: 'discover', expect: { found: [] } });
var callAdopt = rpc.declare({ object: 'moca', method: 'adopt',
	params: [ 'mac', 'ip', 'name', 'vendor', 'username', 'password', 'reserve' ], expect: {} });

var VENDORS = {
	frontier: { label: 'Frontier (FC252/FCA251)', user: 'admin', pass: 'cambridge', ip: '192.168.188.251' },
	verizon:  { label: 'Verizon (ASK-MAE340)',    user: 'admin', pass: 'admin',     ip: '192.168.1.1' },
	gocoax:   { label: 'GoCoax (MA2500D)',        user: 'admin', pass: 'gocoaxx',   ip: '192.168.144.200' },
	generic:  { label: 'Generic MaxLinear',       user: 'admin', pass: '',          ip: '' }
};

var CHIPS = [ 'MXL370x', 'MXL371x', 'MXL372x', 'MXL373x' ];

/* ---- /ms helpers (all knowledge of the param store lives here) ---- */
function ms(id, path, body) {
	return callRequest(id, path, body || '{"data":[]}').then(function(r) {
		r = r || {};
		var data = null;
		if (r.raw) {
			try { data = JSON.parse(r.raw).data; } catch (e) { data = null; }
		}
		return { code: r.code || 0, data: data, raw: r.raw || '' };
	});
}
function readCfg(id, bank, pid) {
	return ms(id, bank + '/' + pid + '/GET').then(function(r) {
		return (r.data && r.data.length) ? parseInt(r.data[0], 16) : null;
	});
}
function readStatus(id, bank, pid, node) {
	var body = '{"data":[' + (node != null ? node : '') + ']}';
	return ms(id, bank + '/' + pid, body).then(function(r) { return r.data; });
}
function writeCfg(id, bank, pid, value) {
	return ms(id, bank + '/' + pid + '/PUT', '{"data":[' + value + ']}');
}
function action(id, path) { return ms(id, path, '{"data":[]}'); }
function hex2mac(hi, lo) {
	function b(v, s) { return ('0' + ((v >> s) & 0xff).toString(16)).slice(-2); }
	return [ b(hi,24), b(hi,16), b(hi,8), b(hi,0), b(lo,24), b(lo,16) ].join(':');
}
function mocaVerStr(v) { return ((v >> 4) & 0xf) + '.' + (v & 0xf); }

/* ---- live device panel ---- */
function statusRow(label, value) {
	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td left', 'width': '33%' }, label),
		E('td', { 'class': 'td left' }, value)
	]);
}

function renderStatus(id, target) {
	target.innerHTML = '';
	target.appendChild(E('em', {}, _('Querying adapter…')));
	Promise.all([
		ms(id, '1/0x103/GET'), readCfg(id, '1', '0x303'), ms(id, '1/0x20b/GET'),
		readCfg(id, '0', '0x1003'), readStatus(id, '0', '0x15', '')
	]).then(function(res) {
		var sw = res[0].data, chip = res[1], ip = res[2].data, lof = res[3], present = res[4];
		var swStr = '–';
		if (sw && sw.length) swStr = sw.map(function(w) { return w.replace(/^0x/, ''); }).join('');
		var chipStr = (chip != null && CHIPS[chip - 0x15]) ? CHIPS[chip - 0x15]
			: (chip != null ? ('chip 0x' + chip.toString(16)) : '–');
		var ipStr = '–';
		if (ip && ip.length) {
			var v = parseInt(ip[0], 16);
			ipStr = (v>>>24 & 0xff)+'.'+(v>>16 & 0xff)+'.'+(v>>8 & 0xff)+'.'+(v & 0xff);
		}
		var nodes = '–';
		if (present == null) nodes = _('standalone / no peers reported');
		else if (present.length) nodes = '0x' + (parseInt(present[0], 16) >>> 0).toString(16);
		var tbl = E('table', { 'class': 'table' }, [
			statusRow(_('Chip'), chipStr),
			statusRow(_('Firmware'), swStr),
			statusRow(_('Management IP'), ipStr),
			statusRow(_('Last operating freq'), lof != null ? (lof + ' MHz') : '–'),
			statusRow(_('Present nodes (mask)'), nodes)
		]);
		target.innerHTML = '';
		target.appendChild(tbl);
	}).catch(function(e) {
		target.innerHTML = '';
		target.appendChild(E('p', { 'class': 'alert-message warning' },
			_('Adapter unreachable or rejected the request: ') + (e.message || e)));
	});
}

function renderNetwork(id, target) {
	target.innerHTML = '';
	target.appendChild(E('em', {}, _('Reading network node table…')));
	readStatus(id, '0', '0x15', '').then(function(present) {
		if (present == null || !present.length) {
			target.innerHTML = '';
			target.appendChild(E('p', { 'class': 'cbi-value-description' },
				_('No live coax peers reported by this adapter.')));
			return;
		}
		var mask = parseInt(present[0], 16) >>> 0, ids = [];
		for (var n = 0; n < 16; n++) if (mask & (1 << n)) ids.push(n);
		return Promise.all(ids.map(function(n) {
			return Promise.all([
				readStatus(id, '0', '0x16', n),
				readStatus(id, '0', '0x103', n)
			]).then(function(rr) {
				var info = rr[0], mac = rr[1];
				var ver = (info && info.length > 4) ? (parseInt(info[4], 16) & 0xff) : 0;
				var guid = (mac && mac.length > 1)
					? hex2mac(parseInt(mac[0], 16), parseInt(mac[1], 16)) : '–';
				return { node: n, ver: ver, guid: guid };
			});
		})).then(function(rows) {
			var tbl = E('table', { 'class': 'table' }, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, _('Node')),
					E('th', { 'class': 'th' }, _('MoCA version')),
					E('th', { 'class': 'th' }, _('GUID'))
				])
			]);
			rows.forEach(function(r) {
				tbl.appendChild(E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td' }, String(r.node)),
					E('td', { 'class': 'td' }, r.ver ? mocaVerStr(r.ver) : '–'),
					E('td', { 'class': 'td' }, r.guid)
				]));
			});
			target.innerHTML = '';
			target.appendChild(tbl);
		});
	}).catch(function(e) {
		target.innerHTML = '';
		target.appendChild(E('p', { 'class': 'alert-message warning' },
			_('Network read failed: ') + (e.message || e)));
	});
}

var CFG_PARAMS = [
	{ pid: '0x1003', bank: '0', label: _('Last operating freq (MHz)'), min: 0, max: 1600 },
	{ pid: '0x1009', bank: '0', label: _('Band mask (hex)'), hex: true },
	{ pid: '0x100e', bank: '0', label: _('Beacon power'), min: 0, max: 60 },
	{ pid: '0x10a8', bank: '0', label: _('TX power'), min: 0, max: 60 },
	{ pid: '0x1002', bank: '0', label: _('Preferred NC (0/1)'), min: 0, max: 1 },
	{ pid: '0x1001', bank: '0', label: _('Network search (0/1)'), min: 0, max: 1 }
];

function renderConfig(id, target) {
	target.innerHTML = '';
	var tbl = E('table', { 'class': 'table' });
	target.appendChild(tbl);
	CFG_PARAMS.forEach(function(p) {
		var input = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'style': 'width:8em' });
		var btn = E('button', { 'class': 'cbi-button cbi-button-save' }, _('Set'));
		var st = E('span', { 'style': 'margin-left:.5em' });
		readCfg(id, p.bank, p.pid).then(function(v) {
			if (v != null) input.value = p.hex ? ('0x' + (v >>> 0).toString(16)) : String(v);
		});
		btn.addEventListener('click', function() {
			var raw = (input.value || '').trim();
			var val = p.hex ? raw : parseInt(raw, 10);
			if (!p.hex && (isNaN(val) || (p.min != null && val < p.min) || (p.max != null && val > p.max))) {
				st.textContent = _('invalid'); st.style.color = '#c00'; return;
			}
			st.textContent = _('saving…'); st.style.color = '';
			writeCfg(id, p.bank, p.pid, p.hex ? raw : val).then(function(r) {
				var ok = (r.code >= 200 && r.code < 300);
				st.textContent = ok ? _('saved') : (_('error ') + r.code);
				st.style.color = ok ? '#080' : '#c00';
			});
		});
		tbl.appendChild(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td left', 'width': '40%' }, p.label),
			E('td', { 'class': 'td left' }, [ input, ' ', btn, st ])
		]));
	});
}

function renderActions(id, target) {
	target.innerHTML = '';
	function actBtn(label, path, cls, confirmMsg) {
		var b = E('button', { 'class': 'cbi-button ' + cls, 'style': 'margin-right:.5em' }, label);
		b.addEventListener('click', function() {
			if (!confirm(confirmMsg)) return;
			action(id, path).then(function(r) {
				ui.addNotification(null, E('p', {},
					(r.code >= 200 && r.code < 300)
						? _('Command accepted by the adapter.')
						: (_('Adapter returned HTTP ') + r.code)));
			});
		});
		return b;
	}
	target.appendChild(actBtn(_('Reboot adapter'), '1/0xb00', 'cbi-button-reset',
		_('Reboot this MoCA adapter? The coax link will drop briefly.')));
	target.appendChild(actBtn(_('Factory restore'), '1/0xb01', 'cbi-button-negative',
		_('Factory-restore this adapter? All its settings (incl. IP) reset to defaults.')));
}

function deviceCard(a) {
	var body = E('div');
	var tabs = E('div', { 'class': 'cbi-tabmenu' });
	var panes = { status: E('div'), network: E('div'), config: E('div'), actions: E('div') };
	var renderers = { status: renderStatus, network: renderNetwork, config: renderConfig, actions: renderActions };

	function show(which) {
		Object.keys(panes).forEach(function(k) { panes[k].style.display = (k === which) ? '' : 'none'; });
		renderers[which](a.id, panes[which]);
	}
	[ ['status', _('Status')], ['network', _('Network')],
	  ['config', _('Config')], ['actions', _('Actions')] ].forEach(function(t) {
		var link = E('a', { 'href': '#' }, t[1]);
		link.addEventListener('click', function(ev) { ev.preventDefault(); show(t[0]); });
		tabs.appendChild(E('span', { 'style': 'margin-right:1em' }, link));
	});
	body.appendChild(tabs);
	Object.keys(panes).forEach(function(k) { body.appendChild(panes[k]); });
	var card = E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, a.name + ' — ' + a.host + (a.enabled ? '' : ' (' + _('disabled') + ')')),
		body
	]);
	if (a.enabled) show('status');
	else body.style.display = 'none';
	return card;
}

return view.extend({
	load: function() {
		return Promise.all([
			callList().catch(function() { return []; }),
			uci.load('moca_other')
		]);
	},

	render: function(data) {
		var adapters = data[0] || [];

		var m = new form.Map('moca_other', _('Adapter inventory'),
			_('Standalone MoCA adapters the router manages over each adapter\'s HTTP /ms ' +
			  'API. Credentials stay on the router.'));
		var s = m.section(form.GridSection, 'adapter', _('Adapters'));
		s.addremove = true;
		s.anonymous = false;
		s.nodescriptions = true;
		var o;
		o = s.option(form.Value, 'name', _('Name'));
		o.placeholder = 'Living Room';
		o = s.option(form.Value, 'host', _('Management IP'));
		o.datatype = 'host';
		o.placeholder = '192.168.1.238';
		o = s.option(form.ListValue, 'vendor', _('Vendor'));
		Object.keys(VENDORS).forEach(function(k) { o.value(k, VENDORS[k].label); });
		o.default = 'frontier';
		o = s.option(form.Value, 'username', _('Web user'));
		o.placeholder = 'admin';
		o.modalonly = true;
		o = s.option(form.Value, 'password', _('Web password'));
		o.password = true;
		o.modalonly = true;
		o = s.option(form.Value, 'mac', _('MoCA GUID / MAC'));
		o.placeholder = 'aa:bb:cc:dd:ee:ff';
		o.modalonly = true;
		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.default = '1';

		/* discovery */
		var discResult = E('div');
		var discBtn = E('button', { 'class': 'cbi-button cbi-button-action' }, _('Scan the coax network'));
		function chipName(v) {
			var n = parseInt(v, 16);
			return (!isNaN(n) && CHIPS[n - 0x15]) ? CHIPS[n - 0x15] : (v ? ('chip ' + v) : '–');
		}
		discBtn.addEventListener('click', function() {
			discBtn.disabled = true;
			discResult.innerHTML = '';
			discResult.appendChild(E('em', {}, _('Scanning (DHCP leases + shared static IP)…')));
			callDiscover().then(function(found) {
				discBtn.disabled = false;
				discResult.innerHTML = '';
				if (!found || !found.length) {
					discResult.appendChild(E('p', { 'class': 'cbi-value-description' },
						_('No MoCA adapters found. Factory-fresh units may need the ' +
						  'static-IP alias set in /etc/config/moca_other.')));
					return;
				}
				var tbl = E('table', { 'class': 'table' }, [
					E('tr', { 'class': 'tr table-titles' }, [
						E('th', { 'class': 'th' }, _('IP')), E('th', { 'class': 'th' }, _('MAC')),
						E('th', { 'class': 'th' }, _('Chip')), E('th', { 'class': 'th' }, _('Via')),
						E('th', { 'class': 'th' }, '')
					])
				]);
				found.forEach(function(a) {
					var adopt = E('button', { 'class': 'cbi-button cbi-button-add' }, _('Adopt'));
					adopt.addEventListener('click', function() {
						adopt.disabled = true;
						callAdopt(a.mac || '', a.ip, '', 'generic', a.cred || 'admin', '', '1').then(function() {
							ui.addNotification(null, E('p', {},
								_('Adopted %s — reloading.').format(a.ip)));
							window.setTimeout(function() { location.reload(); }, 800);
						});
					});
					tbl.appendChild(E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td' }, a.ip),
						E('td', { 'class': 'td' }, a.mac || '–'),
						E('td', { 'class': 'td' }, chipName(a.chip)),
						E('td', { 'class': 'td' }, a.via),
						E('td', { 'class': 'td' }, adopt)
					]));
				});
				discResult.appendChild(tbl);
			}).catch(function(e) {
				discBtn.disabled = false;
				discResult.innerHTML = '';
				discResult.appendChild(E('p', { 'class': 'alert-message warning' },
					_('Discovery failed: ') + (e.message || e)));
			});
		});

		var discovery = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('Discover adapters')),
			E('div', { 'class': 'cbi-section' }, [
				E('p', { 'class': 'cbi-value-description' },
					_('Finds MoCA adapters via DHCP leases and the shared factory static ' +
					  'IP (ARP-enumerated). Adopt adds them to the inventory with a DHCP ' +
					  'reservation for a stable address.')),
				discBtn, ' ', discResult
			])
		]);

		var live = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('Devices')),
			(adapters.length
				? E('div', {}, adapters.map(deviceCard))
				: E('p', { 'class': 'cbi-value-description' },
					_('No adapters configured yet. Add one above, then Save & Apply.')))
		]);

		return m.render().then(function(mapEl) {
			return E('div', {}, [ mapEl, discovery, live ]);
		});
	}
});
