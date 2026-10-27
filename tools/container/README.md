# Installer container (for a TV in another network)

The installer has to run **in the same network as the TV**: it searches with SSDP, talks
SSAP to port 3000/3001, opens SSH to port 22 and later serves the exploit page over HTTP.
If your own machine is not in that network (a TV at a relative's place, for example), run the
installer in a container that sits there.

## What is in the image

Debian slim plus exactly what the tools need: `bash`, `python3`, `openssh-client`, `curl`,
`git`, `iproute2`, `iputils-ping`. The repo is **mounted**, not copied, so the scripts you
run are the ones you have on disk.

## Run it

```sh
cd tools/container
docker build -t cleanframe-installer .

# in the network of the TV, with the repo mounted:
docker run --rm -it --network host -v "$PWD/../..:/cleanframe" cleanframe-installer --info
docker run --rm -it --network host -v "$PWD/../..:/cleanframe" cleanframe-installer --dry-run
docker run --rm -it --network host -v "$PWD/../..:/cleanframe" cleanframe-installer 192.168.1.50
```

`--network host` is not optional: with bridge networking the container cannot see the LAN
broadcast for SSDP and cannot reach the TV. `-it` keeps the confirmation dialog and the
pairing prompt usable.

A run of `tools/root/root-it.sh` fetches SlopBro into the container's home directory, which is
throwaway. Mount a directory over it to keep it:

```sh
docker run --rm -it --network host \
  -v "$PWD/../..:/cleanframe" -v "$PWD/slopbro:/root/.cache/cleanframe" \
  cleanframe-installer --tv 192.168.1.50 --launcher-only
```

## On TrueNAS SCALE (custom app)

Apps → Discover → *Custom App* → *Install via YAML*. Two things matter: host networking and
keep the container alive long enough to exec into it, otherwise it exits after `--help`.

```yaml
services:
  cleanframe-installer:
    image: cleanframe-installer:latest
    container_name: cleanframe-installer
    network_mode: host
    stdin_open: true
    tty: true
    command: ["sleep", "infinity"]
    environment:
      - LANG=C.UTF-8
    volumes:
      - /mnt/<pool>/apps/cleanframe-installer/repo:/cleanframe
```

Put the repo into that dataset (clone it there, or copy the directory), then:

```sh
docker exec -it cleanframe-installer bash tools/install.sh --info
```

On TrueNAS SCALE `docker` may be `k3s`-managed; `midclt call app.create` with the YAML above
works as well. Whatever the route: the container needs **host networking**, and it must be
in the same broadcast domain as the TV.

## What the container does not do

It does not bypass anything: the exploit still needs the pairing prompt accepted on the TV,
and `tools/root/root-it.sh` still stops when the firmware is newer than the exploit. The container only saves you from
driving to the other flat with a laptop.
