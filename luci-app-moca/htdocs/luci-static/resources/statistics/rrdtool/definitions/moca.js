/* SPDX-License-Identifier: GPL-2.0 */
/* Graphs for the MoCA metrics of /usr/libexec/collectd/moca_collectd.sh. */

'use strict';
'require baseclass';

return baseclass.extend({
	title: _('MoCA'),

	rrdargs(graph, host, plugin, plugin_instance, dtype) {
		if (!plugin_instance) {
			/* the local coax link */
			return [ {
				title: "%H: MoCA link uptime",
				vlabel: "Days",
				number_format: "%5.1lf",
				data: {
					types: [ "uptime" ],
					options: {
						uptime_link: { title: "Link up", transform_rpn: "86400,/", noarea: true, color: "0000ff" }
					}
				}
			}, {
				title: "%H: MoCA link drops and dropped frames",
				vlabel: "Count",
				number_format: "%5.1lf",
				data: {
					types: [ "count", "derive" ],
					options: {
						count_link_drops: { title: "Link drops (total)", noarea: true, color: "ff0000" },
						derive_frame_drops: { title: "Dropped frames/s", noarea: true, overlay: true, color: "ff8000" }
					}
				}
			} ];
		}

		/* one coax node, named by its GUID */
		return [ {
			title: "%H: MoCA PHY rate with %pi",
			vlabel: "bit/s",
			number_format: "%5.1lf%sbit/s",
			data: {
				types: [ "bitrate" ],
				options: {
					bitrate_rx: { title: "RX from node", noarea: true, color: "00a000" },
					bitrate_tx: { title: "TX to node", noarea: true, overlay: true, color: "0000ff" }
				}
			}
		}, {
			title: "%H: MoCA power with %pi",
			vlabel: "dBm",
			number_format: "%5.1lf dBm",
			data: {
				types: [ "signal_power" ],
				options: {
					signal_power_rx: { title: "RX power", noarea: true, color: "00a000" },
					signal_power_tx: { title: "TX power", noarea: true, overlay: true, color: "0000ff" }
				}
			}
		}, {
			title: "%H: MoCA SNR with %pi",
			vlabel: "dB",
			number_format: "%5.1lf dB",
			data: {
				types: [ "snr" ],
				options: {
					snr_min: { title: "Lowest channel", noarea: true, color: "ff0000" },
					snr_avg: { title: "Channel mean", noarea: true, overlay: true, color: "00a000" }
				}
			}
		} ];
	}
});
