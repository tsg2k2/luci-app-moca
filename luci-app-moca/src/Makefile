# SPDX-License-Identifier: GPL-2.0
CFLAGS += -Wall

compile: moca-sweep

moca-sweep: moca-sweep.c
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $<

install: moca-sweep
	install -D -m 0755 moca-sweep $(DESTDIR)/usr/libexec/moca-sweep

clean:
	rm -f moca-sweep
