FROM ubuntu:26.04

# ubuntu:26.04 ships a `ubuntu` user at UID/GID 1000. ka-jo (created by
# common-utils, see devcontainer.json) needs that UID to match the host user
# that owns the bind mounts, and every devenv path assumes /home/ka-jo.
RUN userdel -r ubuntu

COPY --chmod=755 entrypoint.sh /usr/local/bin/devenv-entrypoint

ENTRYPOINT ["/usr/local/bin/devenv-entrypoint"]
