#!/bin/sh
# SPDX-License-Identifier: GPL-2.0
# collectd exec plugin: MoCA link metrics for luci-app-statistics. Runs as
# nobody and reads only the phy-mxl371x sysfs attributes.
#
#   moca/uptime-link            seconds the coax link has been up
#   moca/count-link_drops       times the link went down since the driver loaded
#   moca/derive-frame_drops     frames the MoCA chip dropped
#   moca-<guid>/bitrate-rx|tx   PHY rate from/to that node, all channels (bit/s)
#   moca-<guid>/signal_power-rx receive power, mean over channels (dBm)
#   moca-<guid>/signal_power-tx transmit power, mean over channels (dBm)
#   moca-<guid>/snr-min|avg     receive SNR, lowest and mean channel (dB)
#
# Power and SNR need moca_link_quality; an older driver gives rates only
# (moca_nodes, Mbit/s).

HOST="${COLLECTD_HOSTNAME:-$(cat /proc/sys/kernel/hostname)}"
INTERVAL="${COLLECTD_INTERVAL:-30}"
INTERVAL="${INTERVAL%.*}"
[ "$INTERVAL" -ge 5 ] 2>/dev/null || INTERVAL=30

moca_dir() {
	local d
	for d in /sys/bus/mdio_bus/devices/*; do
		[ -e "$d/moca_link_status" ] && { echo "$d"; return 0; }
	done
	return 1
}

put() {
	echo "PUTVAL \"$HOST/$1\" interval=$INTERVAL N:$2"
}

sample() {
	local d="$1" v src

	v="$(cat "$d/moca_link_uptime" 2>/dev/null)" && put "moca/uptime-link" "$v"
	v="$(cat "$d/moca_link_lost" 2>/dev/null)" && put "moca/count-link_drops" "$v"
	v="$(cat "$d/moca_frame_drops" 2>/dev/null)" && put "moca/derive-frame_drops" "$v"

	[ "$(cat "$d/moca_link_status" 2>/dev/null)" = up ] || return

	if [ -e "$d/moca_link_quality" ]; then src=quality; else src=nodes; fi
	# "nodeN [guid=..] key=value ..."; moca_nodes rates are Mbit/s
	cat "$d/moca_$( [ $src = quality ] && echo link_quality || echo nodes)" 2>/dev/null |
	awk -v src="$src" -v host="$HOST" -v iv="$INTERVAL" '
		function out(what, val) {
			printf "PUTVAL \"%s/moca-%s/%s\" interval=%d N:%s\n", host, inst, what, iv, val }
		{
			delete kv
			for (i = 2; i <= NF; i++) { split($i, p, "="); kv[p[1]] = p[2] }
			if (src == "nodes" && kv["role"] == "self") next
			inst = kv["guid"]; gsub(":", "", inst)
			if (inst == "" || inst == "unknown") inst = $1
			if (src == "quality") {
				if ("rx_rate" in kv) {
					out("bitrate-rx", kv["rx_rate"])
					out("signal_power-rx", kv["rx_power"])
					out("snr-min", kv["snr_min"])
					out("snr-avg", kv["snr_avg"])
				}
				if ("tx_rate" in kv) {
					out("bitrate-tx", kv["tx_rate"])
					out("signal_power-tx", kv["tx_power"])
				}
			} else {
				if (kv["rx"] > 0) out("bitrate-rx", kv["rx"] * 1000000)
				if (kv["tx"] > 0) out("bitrate-tx", kv["tx"] * 1000000)
			}
		}'
}

while :; do
	d="$(moca_dir)" && sample "$d"
	sleep "$INTERVAL"
done
