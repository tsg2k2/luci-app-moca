# Controlling OTHER MoCA adapters from the router — OEM method + API reference

This document describes how the OEM (ASK / Frontier / Verizon) firmware manages **other
MoCA nodes on the coax network** — i.e. the MoCA *bridge adapters* sitting next to TVs and
set-top boxes — and how the `luci-app-moca-other` LuCI app reproduces that from OpenWrt on
the CR1000A.

It is the companion of `luci-app-moca`, which controls the **router's own** MXL3711 MoCA
PHY over the kernel `phy-mxl371x` sysfs/mailbox. This app instead reaches **standalone
adapters** (Verizon, Frontier FC252, GoCoax …) the same way the OEM does: over **IP, via
each adapter's HTTP web-management API**.

---

## 1. Two completely different control planes — don't confuse them

| Plane | Reaches | Transport | Used by |
|---|---|---|---|
| **Local MoCA mailbox** | the router's *own* MXL3711 SoC | MDIO indirect window → SoC mailbox (`0x101xxxx` clink cmds) | `phy-mxl371x` driver + `luci-app-moca` |
| **MoCA L2ME node table** | *every* node on the coax, vendor-agnostic, but **read-only telemetry** | the local SoC asks peers over MoCA L2ME; surfaced as `GetNetInfo`/`GetFmrInfo` | OEM "Phy Rates"/status pages |
| **Per-adapter HTTP web API** | one specific adapter, by its **management IP** | HTTP POST `/ms/<bank>/<id>/{GET,PUT}` | **this app** + every OEM adapter web UI |

The crucial realisation (and the correction that drove this work): **the OEM does not
reconfigure remote adapters over MoCA.** MoCA L2ME only lets a node *read* network-wide
telemetry (who's present, PHY-rate matrix, each node's GUID/MoCA-version). To actually
**control** a remote adapter — set its LOF, band mask, privacy password, rename it, reboot
it, factory-reset it — the OEM firmware opens an **HTTP connection to that adapter's own
embedded web server** and drives the MaxLinear `/ms/` parameter-store REST API. That is
what we replicate here.

These adapters are all **MaxLinear-based MoCA bridges** running the same reference web
stack (`main.js`, `index.html`, `devStatus.html`, `phyRates.html`, `security.html`,
`devSetup.html`, `reboot.html`, `upgrade.html`), with per-OEM cosmetic skins. Because the
stack is shared, **one client speaks to all of them**; only the default IP/credentials and
a few enabled params differ per vendor (§5).

---

## 2. The `/ms/` parameter-store REST API

Ground-truthed live against a Frontier MaxLinear bridge at `http://192.168.1.238`
(`admin:cambridge`) and from its own `main.js`.

### Request shape

```
POST /ms/<bank>/<paramID>[/GET|/PUT]   HTTP/1.1
Authorization: Basic base64(user:pass)
Content-Type: application/x-www-form-urlencoded
X-CSRF-TOKEN: <value of csrf_token cookie>      ; only newer FW, PUT only
Accept: text/html, */*

{"data":[<arg0>,<arg1>,...]}
```

* **bank 0** = MoCA / PHY parameters (the `0x1xxx` config IDs and `0x00xx` status IDs).
* **bank 1** = device / management parameters (IP, admin password, chip/sw version, name,
  reboot, factory-reset).
* **`/GET`** suffix = read a *config* param; bare action (no suffix) = read a *status*
  param group; **`/PUT`** = write.
* The body is JSON `{"data":[ ... ]}`. For a **PUT**, the array holds the new value(s). For
  a **node-indexed status read**, the array holds the **node index** — e.g. read node 2's
  per-node info: `POST /ms/0/0x16` body `{"data":[2]}`. (The OEM pages set
  `document.netInfo.data.value = nodeId` and loop.)
* Auth is HTTP **Basic**. On firmware that enables CSRF, a `csrf_token` cookie is returned
  on the first GET and must be echoed in `X-CSRF-TOKEN` on writes; `192.168.1.238`'s
  firmware does **not** set it, so Basic auth alone suffices. The client handles both.

### Response shape

```json
{ "data": ["0x0000047e"] }
```

32-bit words, **big-endian**, hex strings. Multi-word values (MAC, version, strings) span
several array entries.

### Value encodings

* **Integers** — a single `0x….` word (e.g. LOF `0x47e` = 1150 MHz).
* **MAC / GUID** — two words: `hi`, `lo`; MAC = `hi[31:0]:lo[31:16]`.
* **Strings** (network name, passwords, admin password) — **raw ASCII packed into BE 32-bit
  words, `0xFF`-padded**. e.g. admin pass `"cambridge"` = `63616d62 72696467 6500ffff …`.
  Use the same packing when writing string fields.
* **64-bit masks** (scan masks) — split hi/lo across two words.

---

## 3. Parameter map (banks 0 and 1)

### Config params — bank 0 (read `/GET`, write `/PUT`)

| Name | paramID | Example | Notes |
|---|---|---|---|
| networkSearch | `0x1001` | `0x1` | continuous network search |
| preferredNC | `0x1002` | `0x1` | prefer becoming Network Coordinator |
| LOF / lastOpFreq | `0x1003` | `0x47e` = 1150 MHz | also read-alias `/ms/lastOFrq/GET`; PUT 0..1600 |
| bandMask | `0x1009` | `0x7` | one bit per band index in the scan list |
| beaconPwrLevel | `0x100e` | `0xa` = 10 | |
| txPower | `0x10a8` | `0xa` = 10 | |
| hwCfgWord | `0x10f5` | `0xe0000040` | bit(31-idx) = band idx allowed in scan |
| mocaPassword (network privacy) | `0x1049` | ASCII | MoCA privacy password |
| securityModeMask | `0x1059` | `0x0` | 0 = privacy not enforced |
| enhPrivacyMode | `0x130D` | `0x7` | enhanced-privacy mode 0..7 |
| enhPrivacyPassword | `0x1400` | 16 words ASCII | |
| scanMask[band] | `0x1063`+idx | 64-bit | hi/lo split |
| scanOffset[band] | `0x106b`+idx | `16` | |
| priChAboveMask[band] | `0x1073`+idx | | |
| priChBelowMask[band] | `0x107b`+idx | | |

Band index order: **D-Ext, D-Low, D-High, E, F-SAT, F-CBL, H, Custom**.

### Status params — bank 0 (node-indexed; pass node in body `{"data":[node]}`)

| Name | paramID | Notes |
|---|---|---|
| localInfo / present-node bitmask | `0x15` | which node IDs are present on the net |
| netInfo (per node) | `0x16` | per-node info incl. MoCA version (`[4] & 0xff`: `0x25`=2.5, `0x20`=2.0) |
| linkStatus | `0x14` | `[5]`: 0 = Down, !=0 = Up |
| FMR / phy-rate table | `0x1D` | per-node bitloading → Mbps matrix (see `phyRates.html` math) |
| miscPhyInfo | `0x24` | beacon channel, LOF offsets |
| MoCA version (net) | `0x7f` | |
| MAC/GUID (per node) | `0x103` (bank1) | hi/lo |

> Empty-response quirk: when the bridge has **no live coax peers**, the status group
> (`0x14/0x15/0x16/0x1D/0x24`) returns an **empty body**. Config params still read fine.
> The app treats an empty status read as "standalone / no peers".

### Device / management params — bank 1

| Name | paramID | Example | Decoded |
|---|---|---|---|
| adapterName | `0x212` | index into `myRoom[]` | rename (PUT) |
| adminPassword | `0x20e` | ASCII words | change web login (PUT) |
| ChipID | `0x303` | `0x16` | MaxLinear chip rev (`chipArray[ChipID-0x15]`) |
| MAC / GUID | `0x103` | `0xaabbcc11 0x22330000` | device MAC `hi:lo` (e.g. `aa:bb:cc:11:22:33`); with a **node index** in the body it returns *that node's* GUID. (Earlier mislabelled "swVersion".) |
| IP addr | `0x20b` | `0xc0a801ee` | 192.168.1.238 |
| netmask | `0x210` | `0xffffff00` | |
| gateway | `0x211` | `0xc0a80201` | |
| DHCP on | `0x217` | `0x1` | |
| GPIO/status action | `0xb17` | | |

### Actions — bank 1 (POST, no body needed)

| Action | endpoint |
|---|---|
| Reboot | `POST /ms/1/0xb00` |
| Factory restore | `POST /ms/1/0xb01` |

---

## 4. How the OEM builds the network view (reproduced by the app)

`devStatus.html` / `phyRates.html` orchestrate, in order:

1. `POST /ms/0/0x15` → **present-node bitmask**.
2. For each present node *n*: `POST /ms/0/0x16` body `{"data":[n]}` → per-node `netInfo`
   (MoCA version, GUID via the MAC words), and `POST /ms/0/0x1D` for the FMR row.
3. PHY rate (Mbps) is computed from the bitloading words with the LDPC/FFT formula in
   `phyRates.html` (50 MHz vs 100 MHz profiles) — the app reuses that math.
4. Local identity from `0x103` (sw ver), `0x303` (chip), `0x20b` (IP).

This builds the **whole-network node table** — every adapter's node ID, GUID, MoCA
version, and the full TX/RX PHY-rate matrix between nodes — entirely over the one bridge's
HTTP API, because that bridge's SoC already has the L2ME view of its peers.

---

## 5. Per-vendor notes (scope: Verizon, Frontier FC252, GoCoax)

All three are MaxLinear MoCA-2.x bridges running the same `/ms/` stack. Differences are
default IP, credentials, chip, and which params the skin exposes.

| Vendor / model | Chip | Default mgmt IP | Default login | Notes |
|---|---|---|---|---|
| **Frontier FC252 / FCA251** | MaxLinear MxL371x (MoCA 2.5) | `192.168.188.<model#>` — **FCA251 = `192.168.188.251`**, FC252 = `192.168.188.252` (or DHCP if the network offers it) | `admin` / `cambridge` | Full `/ms/` API. **Verified live**: `192.168.1.238` (DHCP, MAC `aa:bb:cc:11:22:33`) and `192.168.188.251` (static, MAC `aa:bb:cc:44:55:66`). |
| **Verizon ASK‑MAE340** (MoCA Ethernet Adapter) | MaxLinear (MoCA 2.5), made by Askey | **`192.168.1.1`** (per Verizon user guide) | `admin` / password from the unit's **QR label** | This is the OEM "ASK‑MAE340". Verify it speaks the `/ms/` API; the Askey skin may differ and some FW enables the CSRF cookie. |
| **GoCoax** MA2500D / WF‑803M | MaxLinear MxL3710 (MoCA 2.5) | `192.168.144.200` (static mgmt) | `admin` / `gocoaxx` (early FW `admin`/`admin`) | Same `/ms/` stack; reachable on its static mgmt IP regardless of the data subnet. |

> The "shared static IP" is really a **per‑model** static default on a common
> off‑LAN subnet (`192.168.188.x` for Frontier). Two Frontier units of the same
> model *do* collide; different models sit at different last octets. Discovery
> therefore scans a list of these defaults (`globals.static_ips`).

Because the chip family is shared (the **GoCoax is the same MaxLinear family as the
router's own MXL3711**), the param IDs and encodings in §3 apply across all of them. The
app stores a small **vendor profile** (default IP + creds + which optional params to show)
and lets the user override per adapter.

> Reachability: adapters answer on whatever **management IP** they hold on the bridged
> LAN/coax segment. The router can always reach them because it bridges that segment, so
> the app proxies all HTTP through the **router** (rpcd) rather than from the admin's
> browser — this is why it works no matter where you browse LuCI from.

---

## 6. App architecture

```
 Browser (LuCI)
   │  ubus/rpc: luci.moca-other  {list, request}
   ▼
 Router rpcd  /usr/libexec/rpcd/moca-other   (shell + curl)
   │  HTTP POST /ms/<bank>/<id>/...   (Basic auth from /etc/config/moca_other)
   ▼
 MoCA adapter web server (Frontier / Verizon / GoCoax)
```

* `/etc/config/moca_other` — UCI inventory of adapters (`name`, `host`, `vendor`,
  `username`, `password`, `enabled`). Passwords never leave the router.
* `/usr/libexec/rpcd/moca-other` — rpcd object `luci.moca-other`:
  * `list` → adapters (no passwords).
  * `request {id,path,body?}` → proxied `POST http://<host>/ms/<path>` with the adapter's
    Basic-auth creds; returns `{status, body}`. Host comes from UCI (never from the
    caller) so the proxy can't be aimed at arbitrary targets.
* `htdocs/.../view/moca-other/overview.js` — adapter list, per-adapter **Status** (sw/chip/
  IP/link), **Network** node table + PHY-rate matrix, **Config** (LOF, band mask, powers,
  privacy, rename), and **Actions** (reboot, factory restore). All param knowledge lives in
  the JS; the backend is a thin authenticated proxy.

See `MOCA-OTHER-API.md` (this file) for the param semantics the JS encodes.

---

## 7. The shared-static-IP problem, plug-and-play, and dynamic discovery

**The problem.** Factory-fresh MaxLinear MoCA bridges (GoCoax, many Frontier/Verizon
units) all ship on the **same static management IP** — typically `192.168.144.200`. Put
three on one coax and they collide: only one answers ARP for that IP at a time, so you
can't address them individually by IP. (Observed live here: of three peers the router's
MoCA chip reports on the coax, only the one that had taken a **DHCP** lease — `192.168.1.238`,
MAC `aa:bb:cc:11:22:33` — was reachable by IP; the other two were invisible at the shared
static IP.)

The **stable identity** of each adapter is therefore **not its IP** but its **MAC / MoCA
GUID**, which is always unique. Discovery and plug-and-play are built around that.

### Discovery (rpcd `discover` method)

1. **DHCP leases + neighbour table** — the happy path. An adapter that already took a DHCP
   lease appears in `/tmp/dhcp.leases` / `ip neigh`; confirm it with an `/ms/1/0x303`
   probe. MaxLinear OUIs (`04:b6:be`, Entropic `00:23:e9`, …) rank candidates first, but the
   `/ms` probe is the definitive test (vendor-agnostic).
2. **Shared factory static IP** — for colliding factory-fresh units. The router temporarily
   adds an alias on the coax bridge (`globals.static_alias`, e.g. `192.168.144.2/24`),
   `arping`s the shared IP(s) (`globals.static_ips`), and collects **every distinct MAC**
   that replies — that enumeration *is* the device list behind the shared IP. It then pins
   the IP to each MAC in turn with a permanent ARP entry
   (`ip neigh replace <ip> lladdr <mac> dev <br> nud permanent`) and probes `/ms` for that
   specific unit. The alias is removed afterwards.
3. (Optional future) **MoCA L2ME node table** from the router's own `phy-mxl371x` chip —
   `moca_active_nodes` + a per-node GUID read — gives a vendor-agnostic census of every node
   on the coax with no IP at all, to cross-check against what was reached by HTTP.

### Scan (rpcd `scan` method)

`scan {deep}` runs in the background and `scan_status` returns its result. It starts from the census: an
ARP sweep from sender 0.0.0.0 needs no address on the target's subnet, `globals.sweep` lists where to look and
deep adds 192.168.0.0/16. Only MACs in the census are pinned and probed, so nothing else on the LAN sees a login
attempt. `listen {node,mac}` restarts one node and watches its ARP. `readdress` moves one adapter by `/ms`
and reboots it, and a rescan confirms it.

### Plug-and-play (rpcd `adopt` method)

`adopt {mac, ip, reserve:1}` makes a discovered unit permanent:
* writes the adapter into `/etc/config/moca_other` with a **section id derived from its
  MAC** (`moca_<last-8-hex>`), so re-running discovery is idempotent;
* adds a **static DHCP reservation** in `/etc/config/dhcp` keyed on the MAC, so the unit
  always gets the same address and reloads dnsmasq.

The intended turn-key flow: flip each adapter to DHCP once (`/ms/1/0x217=1` + reboot via
`/ms/1/0xb00`); thereafter plugging in a new adapter → it DHCPs → a hotplug/periodic
`discover` finds the new MaxLinear-OUI lease → `adopt` pins a reservation and adds it to the
inventory. No more shared-IP juggling.

### On-silicon notes (validated on the CR1000A, 2026-06-22)

* The driver's `moca_nodes` census lists every coax node by GUID; on the test
  network it showed self + 3 peers, GUIDs matching the adapters found by IP. The
  GUID offset is confirmed (self-row GUID == `moca_guid`).
* **rpcd object name = the script filename** (`moca-other`), not `luci.moca-other`.
  The LuCI `rpc.declare` and the ACL must use `moca-other`.
* **Pre-emptive Basic auth is required.** The router's mbedTLS `curl` does not
  send credentials until challenged, and the adapters answer the first request
  with a plain `401` rather than a `WWW-Authenticate` challenge, so `-u` fails.
  Send `Authorization: Basic <base64(user:pass)>` explicitly (the backend does).
* **`arping` is not in the image**; the static-IP scan uses `ping` to populate
  the neighbour table, then reads the MAC from `ip neigh`. Several units sharing
  the *same* static IP still need `arping` to enumerate.
* **Router-LAN vs adapter-IP collision.** The CR1000A's `br-lan` is `192.168.1.1`
  — the *same* as the Verizon ASK-MAE340 default. An adapter sitting on the
  router's own IP is shadowed and unreachable; renumber one of them (give the
  adapter a DHCP reservation / unique static IP) to manage it.

### Config knobs (`/etc/config/moca_other` `globals`)

| Option | Default | Purpose |
|---|---|---|
| `bridge` | `br-lan` | bridge that reaches the coax/MoCA segment |
| `static_ips` | `192.168.144.200` | shared factory mgmt IP(s) to ARP-enumerate |
| `static_alias` | `192.168.144.2/24` | temp alias added for the static-IP scan (empty = DHCP-only) |
| `timeout` | `6` | per-request HTTP timeout (s) |

