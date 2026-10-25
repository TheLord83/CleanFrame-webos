# CleanFrame installer container
#
# A throwaway box with exactly the tools the installer needs: bash, python3,
# openssh-client, curl, git. Handy when the machine you sit at is not the machine
# on the same network as the TV (for example a NAS in another flat).
#
#   docker build -t cleanframe-installer .
#   docker run --rm -it --network host -v "$PWD/..:/cleanframe" cleanframe-installer
#
# --network host matters: the installer discovers the TV with SSDP (broadcast)
# and talks to it on the local LAN. Bridge networking would hide both.

FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      git \
      iproute2 \
      iputils-ping \
      openssh-client \
      python3 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /cleanframe

# The repo is mounted at /cleanframe; without a mount the container still works as a
# plain toolbox (python3, ssh, curl, git) and prints how to mount it.
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["--help"]
