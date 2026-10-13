# Managed cloud runtime (in progress)

This is the execution component for browser-only PaastaCode. It is not yet an
enabled customer service. The account-authorized web proxy, paid resource
provisioning, persistence/restore acceptance and production rollout remain open.

Each workspace must receive its own isolated workload and persistent data mount.
Set `PAASTACODE_CLOUD_DATA` to that absolute mount path and
`PAASTACODE_CLOUD_SECRET_FILE` to a read-only mounted 32-byte base64url secret.
Run `node cloud/start.mjs`. The private listener uses port 8080; `/health` exposes
readiness only. Authenticated calls use a strict API allowlist. The gateway never
accepts browser origins, forwards browser cookies, or exposes daemon shutdown,
updater controls, raw engine APIs or the internal MCP transport.

The Paasta control plane must authenticate the user and check current tenant and
workspace ownership for **every** call. A workspace secret is a service
credential, not a substitute for that authorization. Do not expose this listener
through a public ingress. Apply network isolation before starting it, and run as
an unprivileged user with no service-account token, no host mounts, a read-only
root filesystem, dropped capabilities and a resource limit.

The `/data` equivalent retains repository files, engine sessions and protected
account state across container replacement. Deleting a browser tab must not
delete or stop that workspace. Storage and compute must use the existing Paasta
plan selection, price review and idempotent billing lifecycle before provisioning.
