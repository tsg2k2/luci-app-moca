// SPDX-License-Identifier: GPL-2.0-only
/*
 * moca-sweep: find the IP of a known MAC on an unknown subnet.
 *
 * One ICMP echo per /24 goes to the MAC, addressed to 255.255.255.255 from
 * a.b.x.2.  An adapter answers only when x.2 is on its own subnet, and asks
 * for it by ARP, which names the adapter's real address.  256 frames cover a
 * /16, and only the listed MACs ever see one.
 *
 *   moca-sweep <ifname> <a.b>... -- <mac>...
 *
 * prints "<ip> <mac>" for each MAC that answers.
 */
#include <arpa/inet.h>
#include <linux/if_ether.h>
#include <linux/if_packet.h>
#include <net/if.h>
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#define MAX_MACS	16
#define FRAME_GAP_NS	2000000
#define SETTLE_MS	1500

static const uint8_t pass_host[] = { 2, 253 };	/* the second, in case .2 is taken */

struct target {
	uint8_t mac[ETH_ALEN];
	int found;
};

static struct target targets[MAX_MACS];
static int ntargets, sock, ifindex;
static uint8_t ifmac[ETH_ALEN];

static uint16_t csum(const void *p, int n)
{
	const uint8_t *b = p;
	uint32_t s = 0;

	for (; n > 1; n -= 2, b += 2)
		s += b[0] << 8 | b[1];
	if (n)
		s += b[0] << 8;
	while (s >> 16)
		s = (s & 0xffff) + (s >> 16);
	return ~s;
}

static void put16(uint8_t *p, uint16_t v)
{
	p[0] = v >> 8;
	p[1] = v;
}

static void send_probe(const struct target *t, const uint8_t *src)
{
	struct sockaddr_ll sa = {
		.sll_family = AF_PACKET,
		.sll_ifindex = ifindex,
		.sll_halen = ETH_ALEN,
	};
	uint8_t f[98] = { 0 }, *ip = f + 14, *icmp = ip + 20;

	memcpy(f, t->mac, ETH_ALEN);
	memcpy(f + ETH_ALEN, ifmac, ETH_ALEN);
	put16(f + 12, ETH_P_IP);

	ip[0] = 0x45;
	put16(ip + 2, sizeof(f) - 14);
	ip[8] = 64;
	ip[9] = IPPROTO_ICMP;
	memcpy(ip + 12, src, 4);
	memset(ip + 16, 0xff, 4);
	put16(ip + 10, csum(ip, 20));

	icmp[0] = 8;	/* echo request */
	put16(icmp + 6, 1);
	put16(icmp + 2, csum(icmp, sizeof(f) - 34));

	memcpy(sa.sll_addr, t->mac, ETH_ALEN);
	sendto(sock, f, sizeof(f), 0, (struct sockaddr *)&sa, sizeof(sa));
}

static void note(int i, const uint8_t *ip)
{
	const uint8_t *m = targets[i].mac;

	if (targets[i].found || !(ip[0] | ip[1] | ip[2] | ip[3]))
		return;
	targets[i].found = 1;
	printf("%u.%u.%u.%u %02x:%02x:%02x:%02x:%02x:%02x\n", ip[0], ip[1], ip[2], ip[3],
	       m[0], m[1], m[2], m[3], m[4], m[5]);
	fflush(stdout);
}

static void drain(int wait_ms)
{
	struct pollfd pfd = { .fd = sock, .events = POLLIN };
	uint8_t f[128];
	int i, n;

	while (poll(&pfd, 1, wait_ms) > 0) {
		n = recv(sock, f, sizeof(f), MSG_DONTWAIT);
		if (n < 42)
			continue;
		for (i = 0; i < ntargets; i++)
			if (!memcmp(f + ETH_ALEN, targets[i].mac, ETH_ALEN))
				break;
		if (i == ntargets)
			continue;
		if (f[12] == 0x08 && f[13] == 0x06)		/* ARP: sender IP */
			note(i, f + 28);
		else if (f[12] == 0x08 && f[13] == 0x00 &&	/* echo reply: source */
			 (f[14] & 0x0f) == 5 && f[23] == IPPROTO_ICMP && f[34] == 0)
			note(i, f + 26);
	}
}

static int all_found(void)
{
	int i;

	for (i = 0; i < ntargets; i++)
		if (!targets[i].found)
			return 0;
	return 1;
}

int main(int argc, char **argv)
{
	const struct timespec gap = { .tv_nsec = FRAME_GAP_NS };
	struct sockaddr_ll sa = { .sll_family = AF_PACKET, .sll_protocol = htons(ETH_P_ALL) };
	struct ifreq ifr = { 0 };
	int a, sep = 0, nnets, pass, net, x, i;
	uint8_t src[4];

	for (a = 2; a < argc; a++)
		if (!strcmp(argv[a], "--"))
			sep = a;
	if (argc < 5 || sep < 3 || sep == argc - 1 || strlen(argv[1]) >= IFNAMSIZ) {
		fprintf(stderr, "usage: %s <ifname> <a.b>... -- <mac>...\n", argv[0]);
		return 2;
	}
	nnets = sep - 2;
	for (a = sep + 1; a < argc && ntargets < MAX_MACS; a++) {
		uint8_t *m = targets[ntargets].mac;

		if (sscanf(argv[a], "%hhx:%hhx:%hhx:%hhx:%hhx:%hhx",
			   m, m + 1, m + 2, m + 3, m + 4, m + 5) == 6)
			ntargets++;
	}

	sock = socket(AF_PACKET, SOCK_RAW, htons(ETH_P_ALL));
	if (sock < 0) {
		perror("socket");
		return 1;
	}
	strcpy(ifr.ifr_name, argv[1]);
	if (ioctl(sock, SIOCGIFHWADDR, &ifr) < 0) {
		perror(argv[1]);
		return 1;
	}
	memcpy(ifmac, ifr.ifr_hwaddr.sa_data, ETH_ALEN);
	if (ioctl(sock, SIOCGIFINDEX, &ifr) < 0) {
		perror(argv[1]);
		return 1;
	}
	ifindex = sa.sll_ifindex = ifr.ifr_ifindex;
	if (bind(sock, (struct sockaddr *)&sa, sizeof(sa)) < 0) {
		perror("bind");
		return 1;
	}

	for (pass = 0; pass < 2; pass++) {
		for (net = 0; net < nnets; net++) {
			if (sscanf(argv[2 + net], "%hhu.%hhu", src, src + 1) != 2)
				continue;
			src[3] = pass_host[pass];
			for (x = 0; x < 256; x++) {
				src[2] = x;
				for (i = 0; i < ntargets; i++)
					if (!targets[i].found)
						send_probe(&targets[i], src);
				nanosleep(&gap, NULL);
				drain(0);
			}
			drain(SETTLE_MS);
			if (all_found())
				return 0;
		}
	}
	return 0;
}
