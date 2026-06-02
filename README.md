# luci-app-moca

LuCI status app for the MaxLinear **MXL3711 MoCA 2.5** interface on the
Verizon CR1000A (and other boards using the `phy-mxl371x` driver).

Adds a **Status → MoCA** page showing link state, node / network-coordinator
IDs, MoCA version, LOF, firmware build, and the live **per-node PHY-rate
matrix** (asymmetric TX/RX, ~3.5 Gbps on MoCA 2.5).  All values are read from
the driver's `moca_*` sysfs attributes and auto-refresh.

## Build

Add as a feed and install:

```
echo "src-git luci_moca https://github.com/tsg2k2/luci-app-moca.git" >> feeds.conf.default
./scripts/feeds update luci_moca
./scripts/feeds install luci-app-moca
make menuconfig   # enable LuCI -> 3. Applications -> luci-app-moca
```

Requires the `phy-mxl371x` MoCA PHY driver
(https://github.com/tsg2k2/kmod-phy-mxl371x).
