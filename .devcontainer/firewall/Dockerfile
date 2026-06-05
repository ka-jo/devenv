FROM ubuntu:24.04

RUN apt-get update \
    && apt-get install -y --no-install-recommends squid curl ca-certificates inotify-tools \
    && rm -rf /var/lib/apt/lists/*

COPY squid.conf /etc/squid/squid.conf
COPY start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

RUN mkdir -p /var/log/squid \
    && ln -sf /dev/stdout /var/log/squid/access.log \
    && ln -sf /dev/stderr /var/log/squid/cache.log \
    && chown -R proxy:proxy /var/log/squid

EXPOSE 3128

USER proxy
CMD ["/usr/local/bin/start.sh"]
