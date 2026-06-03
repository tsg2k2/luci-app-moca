# luci-base companion patch

The MoCA (coax) and fibre device icons are selected by `getType()` in
luci-base's `network.js`, which has no per-type hook for new media.  This
patch adds `coax`/`fiber` types (driven by the netdev's ethtool `port`
medium, with a `moca` name fallback) so the icons shipped by this package are
used.

Apply against the luci feed before building, e.g.:

    cd feeds/luci && patch -p1 < ../luci_moca/luci-app-moca/contrib/luci-base-moca-coax-fiber-icon.patch

The `port` medium it keys on is exported by netifd via the companion patch in
the OpenWrt tree (`package/network/config/netifd/patches/`).
