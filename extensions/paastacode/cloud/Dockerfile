FROM golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61 AS cli
WORKDIR /build
COPY paasta-cli/ ./
RUN CGO_ENABLED=0 go build -buildvcs=false -trimpath -ldflags="-s -w" -o /paasta .

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/paastacode
COPY package.json package-lock.json ./
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
RUN npm ci --omit=dev && npm cache clean --force
RUN node node_modules/@playwright/mcp/cli.js install-browser --with-deps chromium
COPY bin/ bin/
COPY src/ src/
COPY web/ web/
COPY cloud/ cloud/
COPY licenses/ licenses/
COPY LICENSE OPENCODE_LICENSE THIRD_PARTY_NOTICES.md ./
COPY --from=cli --chmod=755 /paasta engine/paasta
RUN mkdir /data && chown node:node /data
ENV NODE_ENV=production PAASTACODE_CLOUD_DATA=/data PAASTACODE_HOME=/data/account HOME=/data/home PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
USER 1000:1000
EXPOSE 8080
CMD ["node","cloud/start.mjs"]
