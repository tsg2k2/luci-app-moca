'use strict';
'require baseclass';
'require rpc';

/*
 * MXL3711 SoC replies, decoded. Every request goes through the read-only rpcd
 * method "stat", which accepts only known-safe reads (see the rpcd script).
 *
 * Profiles (0x1010020 TX, 0x1010021 RX): request [node, type | channel << 16,
 * detail]. Type 0x21 = MoCA 2.5, channel 0-4. Word 0 = valid. detail = 1 adds
 * the bit-loading table: 64 words x 8 nibbles, low nibble first, one nibble
 * per subcarrier (512 per 100 MHz channel), value = bits per subcarrier.
 *   TX: w10 power reduction dB (TX power = 5 - min(w10, 30) dBm), w12 rate
 *       bits/s, w15..78 bit loading.
 *   RX: w15 rate bits/s, w16 receive power (signed, dBm), w18..81 bit
 *       loading, w82 SNR (dB).
 */

var callStat = rpc.declare({ object: 'moca', method: 'stat', params: [ 'cmds' ], expect: { resp: [] } });
var callSpectrum = rpc.declare({ object: 'moca', method: 'spectrum', params: [ 'node', 'start', 'end' ], expect: {} });

var NODE_STATE = [ _('inactive'), _('assigned'), _('MAP active'), _('admitted'), _('active'),
	_('low-power idle'), _('standby'), _('sleep') ];

function parse(line) {
	if (!line) return null;
	var p = String(line).trim().split(/\s+/);
	if (p.length < 2) return null;
	return p.slice(1).map(function(x) { return parseInt(x, 16) >>> 0; });
}

function s32(x) { return (x >>> 31) ? x - 0x100000000 : x; }
function u64(w, i) { return (i + 1 < w.length) ? w[i] * 4294967296 + w[i + 1] : 0; }
function hex(n) { return '0x' + (n >>> 0).toString(16); }

/* Run a list of "<cmd> [words]" strings; resolves to one word array (or null) each. */
function run(cmds) {
	if (!cmds.length) return Promise.resolve([]);
	return callStat(cmds.join(';')).then(function(r) {
		return cmds.map(function(c, i) { return parse(r && r[i]); });
	});
}

function profCmd(dir, node, ch, detail) {
	return (dir === 'tx' ? '0x1010020 ' : '0x1010021 ') + node + ' ' + hex(0x21 | (ch << 16)) + ' ' + (detail ? 1 : 0);
}

function decTx(w) {
	if (!w || w.length < 13 || !w[0]) return null;
	var red = Math.min(w[10], 30);
	return { rate: w[12], reduction: w[10], power: 5 - red };
}

function decRx(w) {
	if (!w || w.length < 83 || !w[0]) return null;
	return { rate: w[15], power: s32(w[16]), snr: s32(w[82]) };
}

function bitLoading(w, dir) {
	var first = (dir === 'tx') ? 15 : 18, out = [];
	if (!w || !w[0] || w.length < first + 64) return null;
	for (var j = 0; j < 64; j++)
		for (var k = 0; k < 8; k++)
			out.push((w[first + j] >>> (4 * k)) & 0xf);
	return out;
}

function decLocal(w) {
	if (!w || w.length < 13) return null;
	return { self: w[0], nc: w[1], nextNc: w[2], backupNc: w[3], linkUp: !!w[5], mask: w[12] };
}

function decNetInfo(w) {
	if (!w || w.length < 26) return null;
	return {
		state: NODE_STATE[w[2]] || String(w[2]),
		version: ((w[4] >> 4) & 0xf) + '.' + (w[4] & 0xf),
		txCtlGood: u64(w, 6), txCtlErr: u64(w, 8),
		rxCtlGood: u64(w, 12), rxCtlBad: u64(w, 14) + u64(w, 16),
		txDataGood: u64(w, 18), txDataDropped: u64(w, 20),
		rxDataGood: u64(w, 22), rxDataBad: u64(w, 24)
	};
}

/* Beacon channel (PhyMisc w1) and the MoCA 2.5 channel plan (M25PhyMisc w2, w3). */
function decChannels(misc, m25) {
	return {
		beacon: misc && misc.length > 1 ? misc[1] : 0,
		first: m25 && m25.length > 3 ? m25[2] : 0,
		count: m25 && m25.length > 3 ? m25[3] : 0
	};
}

/* Everything the link-quality table needs, for every node but this one. */
function linkQuality() {
	return run([ '0x1010015', '0x1010024', '0x101007f' ]).then(function(r) {
		var local = decLocal(r[0]), chans = decChannels(r[1], r[2]);
		if (!local) return { local: null, chans: chans, nodes: [] };
		var nch = Math.min(Math.max(chans.count, 1), 5), ids = [], cmds = [];
		for (var n = 0; n < 16; n++)
			if ((local.mask >>> n) & 1 && n !== local.self) ids.push(n);
		ids.forEach(function(n) {
			cmds.push('0x1010016 ' + n);
			for (var ch = 0; ch < nch; ch++) {
				cmds.push(profCmd('rx', n, ch, 0));
				cmds.push(profCmd('tx', n, ch, 0));
			}
		});
		return run(cmds).then(function(w) {
			var i = 0;
			var nodes = ids.map(function(n) {
				var node = { id: n, info: decNetInfo(w[i++]), ch: [] };
				for (var ch = 0; ch < nch; ch++)
					node.ch.push({ rx: decRx(w[i++]), tx: decTx(w[i++]),
						mhz: chans.first ? chans.first + ch * 100 : 0 });
				return node;
			});
			return { local: local, chans: chans, nodes: nodes };
		});
	});
}

/* Bit loading of every channel of one link, for the chart. */
function linkBitLoading(node, dir, nch) {
	var cmds = [];
	for (var ch = 0; ch < nch; ch++) cmds.push(profCmd(dir, node, ch, 1));
	return run(cmds).then(function(w) {
		return w.map(function(words) { return bitLoading(words, dir); });
	});
}

/*
 * Spectrum sweep (ACA). Each 100 MHz block reply: w2 result, w5 ACA status,
 * low byte of w6 the reference, bytes 0x20..0x21f 512 bins of 195 kHz
 * (big-endian within each word).
 * Level of bin i = (s8)(ref - bin[i]); a
 * reference of -128 means the block carried no data. Resolves to
 * { node_id, points: [ [MHz, level] ], missing: [ MHz ] } or { error }.
 */
function spectrum(node, start, end) {
	return callSpectrum(node == null ? '' : String(node), start, end).then(function(r) {
		if (!r || r.error) return { error: (r && r.error) || _('no reply') };
		var pts = [], missing = [];
		(r.blocks || []).forEach(function(b) {
			var f0 = b.blk * 25, w = parse(b.resp);
			if (!w || w.length < 136 || (w[6] & 0xff) === 0x80) { missing.push(f0); return; }
			var ref = w[6] & 0xff;
			for (var i = 0; i < 512; i++) {
				var bin = (w[8 + (i >> 2)] >>> (24 - (i & 3) * 8)) & 0xff;	/* big-endian in each word */
				var f = f0 + i * 100 / 512, v = (ref - bin) & 0xff;
				if (f >= start && f < end) pts.push([ f, v > 127 ? v - 256 : v ]);
			}
		});
		return { node_id: r.node_id, points: pts, missing: missing };
	});
}

return baseclass.extend({
	run: run,
	s32: s32,
	u64: u64,
	linkQuality: linkQuality,
	linkBitLoading: linkBitLoading,
	spectrum: spectrum,
	decTx: decTx,
	decRx: decRx,
	decLocal: decLocal,
	decNetInfo: decNetInfo
});
