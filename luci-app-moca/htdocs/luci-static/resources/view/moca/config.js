'use strict';
'require view';
'require form';

/*
 * MoCA configuration form (UCI-backed: /etc/config/moca).  Save & Apply commits
 * UCI and triggers /etc/init.d/moca, which stages the values into the
 * phy-mxl371x moca_cfg_* sysfs attributes and re-initialises the SoC.  The coax
 * link drops for a few seconds while the firmware reloads and the node
 * re-admits.
 */
return view.extend({
	render: function() {
		var m, s, o;

		m = new form.Map('moca', _('MoCA Configuration'),
			_('These settings are applied to the MoCA SoC by re-initialising it. ' +
			  'Applying briefly drops the coax link while the node re-admits.'));

		s = m.section(form.NamedSection, 'settings', 'moca');
		s.anonymous = true;

		o = s.option(form.Flag, 'enabled', _('Manage MoCA settings'),
			_('Push these settings to the SoC on boot and whenever they are saved. ' +
			  'When disabled, the firmware defaults are used.'));

		o = s.option(form.Value, 'lof', _('Last operating frequency'),
			_('Beacon channel, in MHz.'));
		o.datatype = 'range(0,1600)';
		o.placeholder = '1150';

		o = s.option(form.Value, 'network_name', _('Network name'),
			_('Optional MoCA network identifier (up to 32 characters).'));
		o.datatype = 'maxlength(32)';
		o.optional = true;

		o = s.option(form.Flag, 'preferred_nc', _('Prefer Network Coordinator'),
			_('Prefer this node to become the MoCA Network Coordinator.'));

		o = s.option(form.ListValue, 'network_search', _('Network search'));
		o.value('0', _('Off'));
		o.value('1', _('Mode 1'));
		o.value('2', _('Mode 2'));

		o = s.option(form.Flag, 'security_mode', _('Privacy'),
			_('Enable MoCA link encryption.  All nodes must share the password.'));

		o = s.option(form.Value, 'password', _('Privacy password'),
			_('12–17 digits.  Required when privacy is enabled.'));
		o.password = true;
		o.datatype = 'and(uinteger,minlength(1),maxlength(17))';
		o.depends('security_mode', '1');

		o = s.option(form.ListValue, 'enhanced_privacy_mode', _('Enhanced privacy mode'),
			_('Enhanced privacy level (0 = off).'));
		o.value('0', _('Off'));
		o.value('1', '1');
		o.value('2', '2');
		o.value('3', '3');
		o.value('4', '4');
		o.value('5', '5');
		o.value('6', '6');
		o.value('7', '7');
		o.depends('security_mode', '1');
		o.optional = true;

		o = s.option(form.Value, 'enhanced_password', _('Enhanced privacy password'),
			_('Up to 64 digits, for MoCA enhanced privacy.'));
		o.password = true;
		o.datatype = 'and(uinteger,minlength(1),maxlength(64))';
		o.depends('security_mode', '1');
		o.optional = true;

		o = s.option(form.Value, 'beacon_tx_power', _('Beacon TX power'));
		o.datatype = 'range(0,255)';

		o = s.option(form.Value, 'max_tx_power', _('Max TX power'));
		o.datatype = 'range(0,255)';

		o = s.option(form.Value, 'freq_band_mask', _('Frequency band mask'),
			_('Bitmask of enabled frequency bands.'));
		o.datatype = 'range(0,255)';

		s = m.section(form.NamedSection, 'settings', 'moca', _('Coax tuning'),
			_('Leave a field empty to keep the built-in value. "Manage MoCA settings" ' +
			  'must be on. Numbers apply to every frequency band.'));
		s.anonymous = true;

		o = s.option(form.Value, 'phy_margin', _('PHY margin'),
			_('Safety margin the receiver keeps when it chooses a bit rate. Raise it if ' +
			  'Frames dropped on the Status page climbs under load; lower it for more ' +
			  'speed on clean coax. The peers re-measure the link after a change.'));
		o.datatype = 'range(0,255)';
		o.placeholder = '16';

		o = s.option(form.Value, 'phy_margin_nper', _('PHY margin, NPER'),
			_('Same, for the normal packet error rate profile.'));
		o.datatype = 'range(0,255)';
		o.placeholder = '16';

		o = s.option(form.Value, 'phy_margin_vlper', _('PHY margin, VLPER'),
			_('Same, for the very low packet error rate profile.'));
		o.datatype = 'range(0,255)';
		o.placeholder = '17';

		o = s.option(form.Value, 'rlapm_band_mask', _('Receive-level margin bands'),
			_('Bands that add margin by receive level (RLAPM): bit 0 = D, 1 = D-low, ' +
			  '2 = D-high, 3 = E, 4 = F-sat, 5 = F-cable, 6 = H, 7 = custom.'));
		o.datatype = 'range(0,255)';
		o.placeholder = '24';

		o = s.option(form.DynamicList, 'rlapm_profile', _('Receive-level profiles'),
			_('"slot MHz level:margin ...", slots 0-5, levels 0-83. Slots 0 and 1 hold ' +
			  '500 and 850 MHz; band D has none built in.'));

		o = s.option(form.Value, 'sapm_band_mask', _('Subcarrier margin bands'),
			_('Bands that add margin by subcarrier (SAPM), same bits as above.'));
		o.datatype = 'range(0,255)';
		o.placeholder = '0';

		o = s.option(form.DynamicList, 'sapm_profile', _('Subcarrier profiles'),
			_('"slot MHz threshold scstart offset:margin ...", slots 0-3, offsets 0-255, ' +
			  'margin 255 turns a carrier off.'));

		o = s.option(form.ListValue, 'tpc_mode', _('Transmit power control'));
		o.value('', _('Built-in'));
		o.value('0', '0');
		o.value('1', '1');
		o.value('2', '2');
		o.value('3', '3');

		o = s.option(form.Value, 'tpc_rate_nper', _('TPC target rate, NPER'),
			_('PHY rate that power control aims for.'));
		o.datatype = 'range(0,65535)';
		o.placeholder = '680';

		o = s.option(form.Value, 'tpc_rate_vlper', _('TPC target rate, VLPER'));
		o.datatype = 'range(0,65535)';
		o.placeholder = '680';

		o = s.option(form.Value, 'tpc_rate_50', _('TPC target rate, 50 MHz'));
		o.datatype = 'range(0,65535)';
		o.placeholder = '265';

		s = m.section(form.NamedSection, 'settings', 'moca', _('Advanced'),
			_('Rarely needed. A wrong value can slow the link or keep the node off the network.'));
		s.anonymous = true;

		[
			[ 'lmo_mode', _('Link maintenance mode'), '1', 255 ],
			[ 'mii_pause_pri', _('Pause priority level'), '65535', 65535 ],
			[ 'policing_mode', _('Policing'), '0', 1 ],
			[ 'retx_priority', _('Retransmit priority'), '0', 15 ],
			[ 'tx_priority_per', _('TX priority PER'), '0', 15 ],
			[ 'tlp_min', _('TLP min'), '0', 255 ],
			[ 'tlp_max', _('TLP max'), '95', 255 ],
			[ 'turbo_mode', _('Turbo mode'), '0', 1 ],
			[ 'num_channels', _('Number of channels'), '5', 5 ],
			[ 'strip_vlan_tag', _('Strip VLAN tag'), '0', 65535 ]
		].forEach(function(r) {
			o = s.option(form.Value, r[0], r[1]);
			o.datatype = 'range(0,' + r[3] + ')';
			o.placeholder = r[2];
		});

		return m.render();
	}
});
