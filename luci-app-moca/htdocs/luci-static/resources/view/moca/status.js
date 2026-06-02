'use strict';
'require view';
'require fs';
'require poll';

/* CR1000A MXL3711 MoCA PHY sysfs directory. */
var BASE = '/sys/devices/platform/soc@0/90000.mdio/mdio_bus/90000.mdio-1/90000.mdio-1:0f';

/* [ sysfs attribute, label, optional formatter ] */
var OVERVIEW = [
	[ 'moca_link_status',      _('Link status') ],
	[ 'moca_phy_rate',         _('PHY rate (to NC)'), function(v) { return v + ' Mbps'; } ],
	[ 'moca_network_state',    _('Network state') ],
	[ 'moca_version',          _('MoCA version') ],
	[ 'moca_node_id',          _('Node ID') ],
	[ 'moca_nc_node_id',       _('Network Coordinator') ],
	[ 'moca_active_nodes',     _('Active nodes') ],
	[ 'moca_lof',              _('Last operating freq'),
	  function(v) { return (v && v != '0') ? (v + ' MHz') : v; } ],
	[ 'moca_guid',             _('GUID') ],
	[ 'moca_fw_version',       _('Firmware') ],
	[ 'moca_chip_type',        _('Chip') ],
	[ 'moca_security_enabled', _('Security'),
	  function(v) { return (v == '1') ? _('enabled') : _('disabled'); } ]
];

function rd(name) {
	return fs.read(BASE + '/' + name)
		.then(function(v) { return (v || '').trim(); })
		.catch(function() { return '–'; });
}

function readAll() {
	var keys = OVERVIEW.map(function(r) { return r[0]; });
	return Promise.all(keys.map(rd).concat([ rd('moca_phy_rates') ]))
		.then(function(vals) {
			var o = {};
			keys.forEach(function(k, i) { o[k] = vals[i]; });
			o._rates = vals[keys.length];
			return o;
		});
}

return view.extend({
	load: function() {
		return readAll();
	},

	render: function(data) {
		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('MoCA 2.5 Status')),
			E('div', { 'class': 'cbi-section' }, [
				E('div', { 'id': 'moca-overview' })
			]),
			E('h3', {}, _('Per-node PHY rates')),
			E('div', { 'class': 'cbi-section' }, [
				E('div', { 'id': 'moca-rates' })
			])
		]);

		function update(d) {
			var rows = OVERVIEW.map(function(r) {
				var v = d[r[0]];
				if (r[2] && v && v != '–')
					v = r[2](v);
				return E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td left', 'width': '33%' }, r[1]),
					E('td', { 'class': 'td left' }, v)
				]);
			});
			var ov = container.querySelector('#moca-overview');
			ov.innerHTML = '';
			ov.appendChild(E('table', { 'class': 'table' }, rows));

			var rt = E('table', { 'class': 'table' }, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, _('Node')),
					E('th', { 'class': 'th' }, _('TX (Mbps)')),
					E('th', { 'class': 'th' }, _('RX (Mbps)'))
				])
			]);
			(d._rates || '').split('\n').forEach(function(line) {
				var m = line.match(/^node(\d+)\s+tx=(\d+)\s+rx=(\d+)/);
				if (m)
					rt.appendChild(E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td' }, m[1]),
						E('td', { 'class': 'td' }, m[2]),
						E('td', { 'class': 'td' }, m[3])
					]));
			});
			if (rt.childNodes.length == 1)
				rt.appendChild(E('tr', { 'class': 'tr placeholder' }, [
					E('td', { 'class': 'td', 'colspan': '3' }, _('No peers'))
				]));
			var rdiv = container.querySelector('#moca-rates');
			rdiv.innerHTML = '';
			rdiv.appendChild(rt);
		}

		update(data);
		poll.add(function() { return readAll().then(update); }, 5);

		return container;
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
