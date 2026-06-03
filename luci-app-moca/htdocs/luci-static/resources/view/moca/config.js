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

		return m.render();
	}
});
