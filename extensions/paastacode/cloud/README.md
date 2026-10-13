# Managed cloud runtime (in progress)

This is the execution component for browser-only PaastaCode. It is not yet an
enabled customer service. The service-side owner-authorized web proxy is implemented
in the Paasta platform draft. Browser workspace management, paid resource
provisioning, complete persistence/restore acceptance and production rollout remain open.

Each workspace must receive its own isolated workload and persistent data mount.
Set `PAASTACODE_CLOUD_DATA` to that absolute mount path and
`PAASTACODE_CLOUD_SECRET_FILE` to a read-only mounted 32-byte base64url secret.
Set `PAASTACODE_CLOUD_USER_ID` and `PAASTACODE_CLOUD_TENANT_ID` from the immutable
workspace reservation. Startup rejects absent/invalid owner identifiers. Saved
credentials and newly approved device grants must resolve to that exact user and
tenant before being accepted or persisted. Deployment grants inherit the same
binding. A failed or canceled login preserves the previous account on disk.
If a saved login cannot be verified at startup, the runtime stays disconnected
and offers sign-in again while retaining the saved credentials and project data.
Run `node cloud/start.mjs`. The private listener uses port 8080; `/health` exposes
readiness only. Authenticated calls use a strict API allowlist. The gateway never
accepts browser origins, forwards browser cookies, or exposes daemon shutdown,
updater controls, raw engine APIs or the internal MCP transport.
The allowlist includes the managed model workflow and reviewed project imports.
Both sides share `cloud/routes.json`. The control plane sends the workspace
credential in `X-PaastaCode-Cloud-Token` when using the authenticated Kubernetes
pod proxy; its Kubernetes `Authorization` credential is separate and is removed
by [the API server authentication filter](https://github.com/kubernetes/apiserver/blob/master/pkg/endpoints/filters/authentication.go).
Direct private test callers may still use Bearer authentication. The gateway
does not forward either control credential to the local broker.

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
