# MoCA / L2ME command catalog (phy-mxl371x moca_cmd passthrough)

Issue any of these via the driver: `echo "<cmdid> [hex words]" > moca_cmd; cat moca_cmd`
or the app: `ubus call moca-other node_cmd '{"cmd":"<cmdid> [words]"}'`.
req/rsp = request/response byte length; per-node commands take the node id as word0.

| cmd-id | function | req | rsp |
|---|---|---|---|
| 0x1010001 | GetSocStatus | 0 | 0x18 |
| 0x1010008 | SetBeaconPower | 8 | 4 |
| 0x1010009 | GetBeaconPower | 0 | 8 |
| 0x101000b | GetDataStats | 4 | 0x650 |
| 0x1010010 | GetAggrStats | 4 | 0x500 |
| 0x1010011 | GetBridgeStats | 4 | 0x1c |
| 0x1010012 | GetBridgeTable | 8 | 0x104 |
| 0x1010013 | GetEphyStats | 4 | 0x38 |
| 0x1010014 | GetFrameStats | 4 | 0x1b0 |
| 0x1010015 | GetLocalInfo | 0 | 0x74 |
| 0x1010015 | GetTxPwr | 0 | 0x74 |
| 0x1010016 | GetNetInfo | 4 | 0x68 |
| 0x1010018 | SetMcastFilter | 0xc | 4 |
| 0x1010019 | RequestHandoff | 8 | 4 |
| 0x101001a | RequestLmo | 0x14 | 0x220 |
| 0x101001b | RequestNms | 4 | 4 |
| 0x101001c | GetSpectrum | 4 | 4 |
| 0x101001d | GetFmrInfo | 8 | 0x1a0 |
| 0x101001e | GetDdInfo | 4 | 400 |
| 0x101001f | SendBeaconPowerPIE | 0xc | 4 |
| 0x1010020 | GetPhyTxProfile | 0xc | 0x13c |
| 0x1010020 | GetTxPwr | 0xc | 0x13c |
| 0x1010021 | GetPhyRxProfile | 0xc | 0x14c |
| 0x1010022 | GetPhyNode | 4 | 0x14 |
| 0x1010023 | GetPhyEvm | 8 | 0x204 |
| 0x1010024 | GetPhyMisc | 0 | 8 |
| 0x1010026 | GetRetxStats | 4 | 0x80 |
| 0x1010027 | GetMcastFilterMode | 0 | 4 |
| 0x1010028 | SetMcastFilterMode | 4 | 4 |
| 0x1010029 | SetPhyModBitmask | 0xc | 4 |
| 0x1010030 | Sleep | 4 | 8 |
| 0x1010031 | Wake | 4 | 8 |
| 0x1010032 | GetPmCaps | 0 | 8 |
| 0x1010033 | QueryPmState | 4 | 0x10 |
| 0x1010034 | GetPmEvent | 4 | 0x14 |
| 0x1010035 | HostIfReady | 0 | 4 |
| 0x1010040 | CreateFlow | 0x58 | 0x40 |
| 0x1010041 | UpdateFlow | 0x58 | 0x40 |
| 0x1010042 | DeleteFlow | 8 | 8 |
| 0x1010043 | ListFlows | 0x10 | 0x110 |
| 0x1010044 | QueryFlow | 8 | 100 |
| 0x1010045 | GetFlowStats | 4 | 0x28 |
| 0x1010050 | GetSecPassword | 0 | 0x18 |
| 0x1010051 | GetSecInfo | 0 | 0xb0 |
| 0x1010052 | GetSecStats | 4 | 0x24 |
| 0x1010054 | GetFragStats | 4 | 8 |
| 0x1010055 | IssueMocaReset | 0xc | 0x8c |
| 0x1010056 | GetL2meStats | 4 | 0x10 |
| 0x1010057 | GetActiveRlapmByChIndex | 0 | 0x5c |
| 0x1010057 | GetActiveRlapmByChIndex | 4 | 0x5c |
| 0x1010058 | GetActiveSapmByChIndex | 0 | 0x208 |
| 0x1010058 | GetActiveSapmByChIndex | 4 | 0x208 |
| 0x1010059 | GetEndetStatus | 0 | 0x58 |
| 0x101005f | GetEnhancedSecInfo | 0 | 0x68 |
| 0x1010061 | SetMcastCfg | 0x184 | local |
| 0x1010062 | GetPhyOfdmaDef | 0 | 0x3c |
| 0x1010063 | GetPhyOfdmaAssign | 0 | 0x3c |
| 0x1010064 | GetOfdmaParams | 0 | 0x10 |
| 0x1010065 | GetOfdmaTxProfile | 8 | 0x144 |
| 0x1010066 | GetOfdmaRxProfile | 8 | 0x298 |
| 0x1010067 | SetGetTxPwrVar | 0xc | 4 |
| 0x1010071 | GetSwitchTable | 8 | 0x104 |
| 0x1010072 | GetSwitchStats | 4 | 0x60 |
| 0x1010073 | GetSwitchConfig | 4 | 0xa4 |
| 0x1010074 | ResetSwitchConfig | 4 | 4 |
| 0x1010075 | SetSwitchTmo | 4 | 4 |
| 0x1010076 | EnableSwitchVlanCheck | 4 | 4 |
| 0x1010077 | DisableSwitchVlanCheck | 4 | 4 |
| 0x1010078 | EnableSwitchVlanStrip | 4 | 4 |
| 0x1010079 | DisableSwitchVlanStrip | 4 | 4 |
| 0x101007a | SetSwitchVlanPvid | 8 | 4 |
| 0x101007b | AddSwitchVlanId | 8 | 4 |
| 0x101007c | DelSwitchVlanId | 8 | 4 |
| 0x101007d | SetSwitchMgmtMac | 8 | 4 |
| 0x101007e | GetMacDataStats | 4 | 0x40 |
| 0x101007f | GetM25PhyMisc | 0 | 0x10 |
| 0x1010081 | SendNetProxyPacket | 0x5f4 | 4 |
| 0x1010082 | WaitForNetProxyResponse | 4 | 0x5f8 |
| 0x1010083 | WaitForNetProxyRcvReq | 4 | 0x5f8 |
| 0x1010084 | SendNetProxyResponse | 0x5f4 | 4 |
| 0x1010085 | BridgeCtrlGetNwNameRec | 4 | 4 |
| 0x1010086 | BridgeCtrlGetNwNamePayload | 4 | 0x28 |
| 0x1010087 | BridgeCtrlNwNamePayloadTx | 0x4c | 0x48 |
| 0x1010088 | BridgeCtrlNwNamePayloadRx | 0x4c | 0x4c |
| 0x1010089 | BridgeCtrlNetworkJoin | 4 | 4 |
| 0x101008a | BridgeCtrlNetworkJoinCfg | 4 | 4 |
| 0x101008b | SetTrafficPermit | 0x24 | 0 |
| 0x101008c | GetTrafficPermit | 0 | 4 |
| 0x101008d | GetEtherTypeInfo | 0 | 4 |
| 0x101008f | SendNetProxyTestModeCtrl | 4 | 4 |
| 0x1010090 | SetMpsTrigger | 0 | 4 |
| 0x1010091 | GetMpsReport | 0 | 0x84 |
| 0x1010092 | GetMpsState | 0 | 4 |
| 0x1010093 | GetEcbStats | 4 | 100 |
| 0x1010094 | SetSwitchPortConfig | 4 | 4 |
| 0x20004 | Reset | 0 | 0 |
| 0x20004 | Start | 0 | 0 |
| 0x20005 | Stop | 0 | 0 |
| 0x20006 | GetCdInfo | 4 | 0x11c |
| 0x2000b | GetChipType | 0 | 4 |
| 0x2000c | StartDaemon | 0x210 | 0 |
| 0x2000f | StandaloneLowPowerMode | 0 | 0 |
| 0x20010 | SetApplicationTrace | 4 | 0 |

## Reply layouts used by the status page (verified on firmware 1.18.16)

Words are 32-bit as `moca_cmd` prints them. 64-bit counters are two words,
high half first.

**Do not probe unknown argument values.** `0x1010020 <node> 0x22 1` stops the
SoC firmware until the driver reloads it (a coax drop of about a minute).
Several stats requests clear their counters when word 0 is 1: frame stats
0x1010014, aggregate stats 0x1010010, and the other `<cmd> 0x0` stats.

- **0x1010015 GetLocalInfo** (no args): w0 this node, w1 NC, w2 next NC,
  w3 backup NC, w5 link up, w8 role (0 search, 2 client, else NC),
  w11 network MoCA version, w12 active node mask.
- **0x1010016 GetNetInfo** `<node>`: w0-w1 MAC, w2 node state (0 inactive,
  1 assigned, 2 MAP active, 3 admitted, 4 active, 5 low-power idle,
  6 standby, 7 sleep), w4 MoCA version; u64 at w6 TX ctl good, w8 TX ctl
  errors, w12 RX ctl good, w14 + w16 RX ctl bad, w18 TX data good, w20 TX
  data dropped, w22 RX data good, w24 RX data bad.
- **0x1010022 GetPhyNode** `<node>`: w0 valid, w1 frequency offset (s32),
  w3 propagation delay (s32, -1 before ranging), w4 valid TX profile mask.
- **0x1010020 GetPhyTxProfile / 0x1010021 GetPhyRxProfile**
  `<node> <type | channel << 16> <detail>`. Type 0x21 = MoCA 2.5 link,
  channel 0-4; 0xe = broadcast, 0xc = MAP. Also answering on 1.18.16:
  0x1, 0x2, 0x11, 0x15. detail 1 adds the bit-loading table. w0 = valid.
  - TX: w10 TX power reduction dB (TX power = 5 - min(w10, 30) dBm),
    w12 PHY rate bits/s, w15-w78 bit loading.
  - RX: w15 PHY rate bits/s, w16 receive power (s32, dBm), w18-w81 bit
    loading, w82 SNR (dB).
  - Bit loading: 64 words x 8 nibbles, low nibble first = subcarriers 0-511
    of the channel, value = bits on that subcarrier.
- **0x1010024 GetPhyMisc**: w1 beacon channel MHz.
- **0x101007f GetM25PhyMisc**: w2 first MoCA 2.5 channel MHz, w3 channel
  count (100 MHz apart).
- **0x1010014 GetFrameStats** `0x0`: 54 u64 counters, 6 blocks (TX, TX
  errors, unknown, RX, RX errors, RX dropped) of 9 (MAP, RR, LCF, beacon,
  ACF, probe, Eth, OFDMA RR, OFDMA EVM); counter (block k, type t) at
  w 2*(9k+t).
- **0x1010010 GetAggrStats** `0x0`: w0-w159 TX, w160-w319 RX; word i =
  frames that carried i+1 packets.
- **0x101007e GetMacDataStats** `0x0`: word n = TX packets to node n.
- **0x101001c GetSpectrum** `1`/`0` enters/leaves fast capture mode; the
  spectrum itself comes from ACA requests (0x101001a), which are network
  transactions. Not used by the app.
- **0x1010023 GetPhyEvm**: argument layout unknown; not used.
