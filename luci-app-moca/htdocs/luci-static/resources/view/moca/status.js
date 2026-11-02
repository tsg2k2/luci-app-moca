'use strict';
'require view';
'require fs';
'require rpc';
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
	  function(v) { return (v == '1') ? _('enabled') : _('disabled'); } ],
	[ 'moca_soc_health',       _('SoC health') ],
	[ 'moca_frame_drops',      _('Frames dropped') ],
	[ 'moca_link_resets',      _('Link resets') ],
	[ 'moca_admission_status', _('Last admission status') ],
	[ 'moca_phy_rates',        _('PHY rates per node') ]
];

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

var callMpsStart = rpc.declare({ object: 'moca', method: 'mps_start', expect: {} });
var callMpsStatus = rpc.declare({ object: 'moca', method: 'mps_status', expect: {} });

return view.extend({
	load: function() {
		return readAll();
	},

	render: function(data) {
		var mpsBtn = E('button', { 'class': 'cbi-button' }, _('Pair'));
		var mpsResult = E('span');
		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('MoCA 2.5 Status')),
			E('div', { 'class': 'cbi-section' }, [
				E('div', { 'id': 'moca-overview' })
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Pair a node')),
				E('p', { 'class': 'cbi-value-description' }, _('Press this, then the pairing button on the other node within the walk time. Pairing can change the coax password for the whole network; the new one is saved here.')),
				mpsBtn, ' ', mpsResult
			])
		]);

		function mpsWait() {
			return new Promise(function(done) { window.setTimeout(done, 2000); })
				.then(callMpsStatus)
				.then(function(r) {
					if (r.state == 'running')
						return mpsWait();
					mpsBtn.disabled = false;
					mpsResult.textContent = r.result || r.state;
				});
		}

		mpsBtn.addEventListener('click', function() {
			if (!window.confirm(_('Start pairing? This can change the coax password for the whole network.')))
				return;
			mpsBtn.disabled = true;
			mpsResult.textContent = _('Waiting for the other node…');
			callMpsStart().then(function(r) {
				if (r.error) {
					mpsBtn.disabled = false;
					mpsResult.textContent = r.error;
					return;
				}
				return mpsWait();
			});
		});

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
		}

		update(data);
		poll.add(function() { return readAll().then(update); }, 5);

		return container;
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
