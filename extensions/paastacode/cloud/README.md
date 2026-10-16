# Managed cloud runtime (in progress)

## Browser integration acceptance

The beta18 native integration release is public, but its new MCP/skills/browser
runtime has not been promoted to customer cloud workspaces. Do not infer cloud
availability from the native release or from a successful container build.

[Diagnostic run 38833929918](https://github.com/Paasta-Cloud/PaastaCode/actions/runs/38833929918)
at `a8e3b840232e0b325519f0928e3df7e489a108af` failed real sandboxed Chromium
acceptance on both Linux architectures. The preflight recorded UID 1000,
zero effective capabilities, no-new-privileges, seccomp filtering and enforced
`docker-default` AppArmor. The kernel allowed unprivileged user namespaces in
principle and had a nonzero namespace limit, but the isolated `unshare(CLONE_NEWUSER)`
probe returned EPERM. AppArmor's unprivileged-userns restriction was enabled.
These observations do not establish which filter rejected the syscall.

The next infrastructure acceptance must prove sandboxed browser navigation,
interaction and screenshot in the actual workload security configuration, then
rerun authenticated session restore and volume replacement. Keep owner/tenant
authorization, private gateway, network isolation, non-root execution, read-only
root, dropped capabilities and no-new-privileges. Do not use `--no-sandbox`,
privileged containers or an unconfined security profile to pass the gate.
[Playwright's Docker guidance](https://playwright.dev/docs/docker) explains the
browser's user-namespace requirement; a purpose-built isolated runtime requires
its own security review and production-cluster acceptance before rollout.

## Runtime contract

This is the execution component for browser-only PaastaCode. It is not yet an
enabled customer service. The service-side owner-authorized web proxy is implemented
in the Paasta platform draft. Browser workspace management and paid resource
provisioning are implemented; live persistence/restore acceptance and production
rollout remain open.

Publisher builds run through `.github/workflows/paastacode-cloud-image.yml` on
native Linux amd64 and arm64 runners. Each image must pass the non-root,
read-only gateway and real-engine conversation restore/replacement smoke before
publication. SBOM/provenance attestations and a combined immutable digest are
retained as CI artifacts. Set `PAASTACODE_CLOUD_IMAGE` only to that verified
multi-platform reference, and verify anonymous pull access before enabling the
customer catalogue. Image publication alone does not enable provisioning.

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
