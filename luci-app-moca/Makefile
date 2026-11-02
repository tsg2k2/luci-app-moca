# SPDX-License-Identifier: GPL-2.0
# LuCI app for the CR1000A MXL3711 MoCA 2.5 interface: local PHY status and
# configuration, the whole-coax node table (L2ME), and management of other MoCA
# adapters on the network over their HTTP /ms API.

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI app for MoCA 2.5 (MXL3711): status, coax nodes, adapters
LUCI_DEPENDS:=+luci-base +curl +arp-scan

PKG_LICENSE:=GPL-2.0
PKG_MAINTAINER:=Yury Ilyanok <yuryster@gmail.com>

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
