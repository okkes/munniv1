# Raspberry Pi hosting — multi-arch plan

Status: **APPROVED** (2026-07-22); PI1 shipped — release-images now
builds amd64+arm64 natively and merges manifests. Goal: the munni
stack runs on a Raspberry Pi (arm64) the same push-button way it runs
on the NAS (amd64).

## 1. Multi-arch images (the core, and it's cheap)

The user's buildx example is the right idea, minus the QEMU pain we can
skip: GitHub runners now come in both architectures.

- **Preferred: native runners per arch.** `release-images.yml` gains a
  matrix: `ubuntu-latest` (amd64) + `ubuntu-24.04-arm` (arm64, free for
  public repos). Each builds and pushes `-amd64`/`-arm64` tags natively
  (no emulation = full-speed .NET/Vite builds), then one manifest step:
  `docker buildx imagetools create -t ghcr.io/…:latest <both>`.
  Result: the SAME `ghcr.io/okkes/munni-api:latest` pulls the right
  layer everywhere — NAS keeps doing what it does, a Pi just works.
- Fallback (if arm runners misbehave): QEMU + buildx exactly as the
  user's snippet — works, but the .NET compile under emulation is
  5-10× slower; keep as a matrix escape hatch, not the default.
- Base images already multi-arch: node:24-alpine, nginx:alpine,
  mcr.microsoft.com/dotnet/*, postgres, valkey, logto ✓. GlitchTip
  publishes arm64 ✓. The OCR sidecar needs a check (tesseract base) —
  worst case it builds in the same matrix.

## 2. Orchestrator: k3s vs plain compose — recommendation

k3s runs fine on a Pi 4/5, but the munni deploy model is "one box,
one compose file, a poller applies bundles". Kubernetes would replace
a working 100-line apply.sh with manifests, an ingress controller and
cert-manager — real value only if you want multi-node, self-healing
scheduling or GitOps for its own sake.

**Recommendation: Docker Compose on the Pi, same bundle pipeline as
the NAS.** The deploy poller (apply.sh) is already host-agnostic shell;
the Pi gets:
- `deploy/pi/install.sh` — one-time: docker + compose plugin, the
  munni dir, a systemd timer replacing DSM's Task Scheduler (5-min
  apply), UFW openings.
- A third publish target in deploy-nas.yml (rename: deploy-hosts.yml)
  or — simpler — the Pi pulls the SAME published bundle over HTTPS from
  the NAS/GitHub release instead of FileStation push.
- Reverse proxy: the NAS's DSM proxy has no Pi twin — add a bundled
  Caddy container (auto-HTTPS via Let's Encrypt) fronting web/api on
  the Pi; config rendered from the IaC stack file (ties into
  docs/iac-plan.md).

If k3s is still wanted later (say, 2-3 Pis), the images are already
multi-arch and the compose services map 1:1 onto a kustomize overlay —
nothing in this plan blocks it. But as the first step it's cost
without benefit.

## 3. Pi-specific realities

- Postgres on SD card = early death: require an SSD (USB3) in the
  install script's preflight, or at minimum move pg data + WAL there.
- 4GB Pi: GlitchTip (web+worker+valkey) is the heavy half — the stack
  file gets a `telemetry: false` toggle that drops those services on
  small hosts and points the DSNs at the NAS GlitchTip instead.
- Watchtower is NOT used on the NAS and won't be here either — the
  bundle poller stays the single update path.

## Slices

- PI1 release-images arch matrix + manifest merge (NAS unaffected —
  verify by digest that amd64 still deploys)
- PI2 OCR image arm64 check/build
- PI3 deploy/pi/install.sh + systemd apply timer + bundle fetch
- PI4 Caddy front + stack-file rendering (with IaC plan)
- PI5 runbook: flash → install.sh → bootstrap --stack pi → live
