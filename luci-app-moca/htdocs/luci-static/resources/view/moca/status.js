'use strict';
'require view';
'require fs';
'require poll';
'require moca.phy as phy';

/* CR1000A MXL3711 MoCA PHY sysfs directory. */
var BASE = '/sys/devices/platform/soc@0/90000.mdio/mdio_bus/90000.mdio-1/90000.mdio-1:0f';

/* Seconds as "2d 3h 4m 5s"; older drivers lack the attribute ("–"). */
function duration(v) {
	var t = parseInt(v, 10);
	if (isNaN(t)) return v;
	var d = Math.floor(t / 86400), h = Math.floor(t / 3600) % 24, m = Math.floor(t / 60) % 60;
	return (d ? d + 'd ' : '') + (d || h ? h + 'h ' : '') + (d || h || m ? m + 'm ' : '') + (t % 60) + 's';
}

/* [ sysfs attribute, label, optional formatter ] */
var OVERVIEW = [
	[ 'moca_link_status',      _('Link status') ],
	[ 'moca_link_uptime',      _('Link up for'), duration ],
	[ 'moca_link_lost',        _('Link drops since boot') ],
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
	  function(v) { return (v == '1') ? _('enabled') : _('disabled'); } ],
	[ 'moca_soc_health',       _('SoC health') ],
	[ 'moca_frame_drops',      _('Frames dropped') ],
	[ 'moca_link_resets',      _('Link resets') ],
	[ 'moca_admission_status', _('Last admission status') ]
];

/* A channel below this SNR (dB) is marked: bit loading falls off quickly there. */
var LOW_SNR = 20;

function rd(name) {
	return fs.read(BASE + '/' + name)
		.then(function(v) { return (v || '').trim(); })
		.catch(function() { return '–'; });
}

function readAll() {
	var keys = OVERVIEW.map(function(r) { return r[0]; });
	return Promise.all(keys.map(rd))
		.then(function(vals) {
			var o = {};
			keys.forEach(function(k, i) { o[k] = vals[i]; });
			return o;
		});
}

function readQuality() {
	return phy.linkQuality().catch(function() { return null; });
}

function mbps(bits) { return Math.round(bits / 1e6); }

function sum(chs, dir) {
	return chs.reduce(function(a, c) { return a + ((c[dir] && c[dir].rate) || 0); }, 0);
}

/* "min … max" over the channels that report the field. */
function span(chs, dir, key, unit) {
	var v = chs.map(function(c) { return c[dir] ? c[dir][key] : null; })
		.filter(function(x) { return x != null; });
	if (!v.length) return '–';
	var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v);
	return (lo === hi ? String(lo) : lo + ' … ' + hi) + ' ' + unit;
}

function lowSnr(chs) {
	return chs.some(function(c) { return c.rx && c.rx.snr < LOW_SNR; });
}

function cell(v, warn) {
	return E('td', { 'class': 'td', 'style': warn ? 'color:#c00;font-weight:bold' : '' }, v);
}

function channelTable(n) {
	var rows = [ E('tr', { 'class': 'tr table-titles' }, [
		E('th', { 'class': 'th' }, _('Channel')),
		E('th', { 'class': 'th' }, _('RX Mbit/s')),
		E('th', { 'class': 'th' }, _('RX power')),
		E('th', { 'class': 'th' }, _('SNR')),
		E('th', { 'class': 'th' }, _('TX Mbit/s')),
		E('th', { 'class': 'th' }, _('TX power'))
	]) ];
	n.ch.forEach(function(c, i) {
		rows.push(E('tr', { 'class': 'tr' }, [
			cell(c.mhz ? c.mhz + ' MHz' : String(i)),
			cell(c.rx ? String(mbps(c.rx.rate)) : '–'),
			cell(c.rx ? c.rx.power + ' dBm' : '–'),
			cell(c.rx ? c.rx.snr + ' dB' : '–', c.rx && c.rx.snr < LOW_SNR),
			cell(c.tx ? String(mbps(c.tx.rate)) : '–'),
			cell(c.tx ? _('%d dBm (−%d dB)').format(c.tx.power, c.tx.reduction) : '–')
		]));
	});
	return E('table', { 'class': 'table' }, rows);
}

return view.extend({
	load: function() {
		return Promise.all([ readAll(), readQuality() ]);
	},

	render: function(data) {
		var open = {};
		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('MoCA 2.5 Status')),
			E('div', { 'id': 'moca-privacy' }),
			E('div', { 'class': 'cbi-section' }, [
				E('div', { 'id': 'moca-overview' })
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Link quality per node')),
				E('p', { 'class': 'cbi-value-description' },
					_('As this router\'s MoCA chip sees each link. RX is what this router receives from the node, ' +
					  'TX what it sends to it. Power and SNR are per channel, worst to best; TX power is the level ' +
					  'after the node\'s power control (the reduction from the 5 dBm maximum). ' +
					  'A channel with an SNR below %d dB is marked.').format(LOW_SNR)),
				E('div', { 'id': 'moca-quality' })
			])
		]);

		/* Coax is a shared medium: without privacy, anything that reaches the cable joins the LAN. */
		function updatePrivacy(d) {
			var el = container.querySelector('#moca-privacy');
			el.innerHTML = '';
			if (d.moca_link_status !== 'up' || d.moca_security_enabled !== '0')
				return;
			el.appendChild(E('div', { 'class': 'alert-message warning' }, [
				E('strong', {}, _('MoCA privacy is off.')), ' ',
				_('Traffic on the coax is not encrypted, and any MoCA device that reaches the cable joins this ' +
				  'network. Coax can run past your home: a shared building line, or an entry point without a ' +
				  'MoCA filter (often called a PoE filter). Turn on privacy with the same password on every ' +
				  'MoCA device under '),
				E('a', { 'href': L.url('admin/network/moca/config') }, _('Configuration')),
				_(', and fit a filter where the cable enters the home.')
			]));
		}

		function updateOverview(d, q) {
			updatePrivacy(d);
			var rows = OVERVIEW.map(function(r) {
				var v = d[r[0]];
				if (r[2] && v && v != '–')
					v = r[2](v);
				return [ r[1], v ];
			});
			if (q && q.local) {
				rows.push([ _('Next / backup NC'), _('node %d / node %d').format(q.local.nextNc, q.local.backupNc) ]);
				if (q.chans.beacon)
					rows.push([ _('Beacon channel'), _('%d MHz').format(q.chans.beacon) ]);
				if (q.chans.first && q.chans.count)
					rows.push([ _('Data channels'), _('%d × 100 MHz from %d MHz').format(q.chans.count, q.chans.first) ]);
			}
			var ov = container.querySelector('#moca-overview');
			ov.innerHTML = '';
			ov.appendChild(E('table', { 'class': 'table' }, rows.map(function(r) {
				return E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td left', 'width': '33%' }, r[0]),
					E('td', { 'class': 'td left' }, r[1])
				]);
			})));
		}

		function updateQuality(q) {
			var el = container.querySelector('#moca-quality');
			el.innerHTML = '';
			if (!q || !q.local) {
				el.appendChild(E('em', {}, _('No link data (MoCA down or the chip is not answering).')));
				return;
			}
			if (!q.nodes.length) {
				el.appendChild(E('em', {}, _('No other node on the coax.')));
				return;
			}
			var tbl = E('table', { 'class': 'table' }, [ E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Node')),
				E('th', { 'class': 'th' }, _('State')),
				E('th', { 'class': 'th' }, _('RX / TX Mbit/s')),
				E('th', { 'class': 'th' }, _('RX power')),
				E('th', { 'class': 'th' }, _('SNR')),
				E('th', { 'class': 'th' }, _('TX power')),
				E('th', { 'class': 'th' }, _('RX bad / TX dropped')),
				E('th', { 'class': 'th' }, '')
			]) ]);
			q.nodes.forEach(function(n) {
				var info = n.info || {};
				var role = (n.id === q.local.nc) ? ' (NC)' : (n.id === q.local.backupNc ? ' (backup NC)' : '');
				var btn = E('button', { 'class': 'cbi-button cbi-button-neutral' },
					open[n.id] ? _('Hide channels') : _('Channels'));
				btn.addEventListener('click', function() {
					open[n.id] = !open[n.id];
					updateQuality(q);
				});
				var errs = info.rxDataBad != null
					? (info.rxDataBad + info.rxCtlBad) + ' / ' + (info.txDataDropped + info.txCtlErr) : '–';
				tbl.appendChild(E('tr', { 'class': 'tr' }, [
					cell(String(n.id) + role),
					cell(info.state || '–'),
					cell(mbps(sum(n.ch, 'rx')) + ' / ' + mbps(sum(n.ch, 'tx'))),
					cell(span(n.ch, 'rx', 'power', 'dBm')),
					cell(span(n.ch, 'rx', 'snr', 'dB'), lowSnr(n.ch)),
					cell(span(n.ch, 'tx', 'power', 'dBm')),
					cell(errs, info.rxDataBad > 0 || info.txDataDropped > 0),
					E('td', { 'class': 'td' }, btn)
				]));
				if (open[n.id])
					tbl.appendChild(E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'colspan': 8 }, channelTable(n))
					]));
			});
			el.appendChild(tbl);
		}

		updateOverview(data[0], data[1]);
		updateQuality(data[1]);
		poll.add(function() {
			return Promise.all([ readAll(), readQuality() ]).then(function(r) {
				updateOverview(r[0], r[1]);
				updateQuality(r[1]);
			});
		}, 10);

		return container;
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
