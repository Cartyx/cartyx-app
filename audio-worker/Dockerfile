FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev && rm -rf node_modules/.cache

FROM node:22-alpine
ENV NODE_ENV=production
# ffmpeg carries ffprobe; both are required by src/ffmpeg.ts.
RUN apk add --no-cache ffmpeg

# --- Build-time capability assertions ---------------------------------------
# Everything this pipeline needs from ffmpeg was an UNVERIFIED ASSUMPTION until
# this ran: that Alpine's `ffmpeg` package ships `ffprobe` at all, that its
# build carries libopus, and that the encoders and filters src/ffmpeg.ts and
# src/peaks.ts name by string are compiled in. Every one of those fails at
# RUNTIME, per asset — a line in a worker log and a row stuck in `failed`,
# after the image is already live — so they are asserted here instead, where a
# missing capability fails `docker build` and never reaches a cluster.
#
# The second half is a real end-to-end run of the exact chain in
# src/ffmpeg.ts:transcode() and src/peaks.ts:extractPeaks(), because "the
# encoder is listed" and "the encoder works in this combination" are different
# claims, and it is the combination that Group A's fixes turn on (-map 0:a:0,
# loudnorm, -ar 48000, -ac 2, +faststart). One second of PCM noise from
# /dev/urandom is the input rather than an `sine` lavfi source so the assertion
# does not itself depend on a device the worker never uses — and noise, not
# silence, because loudnorm divides by the measured level and emits NaN on
# digital silence (see the `analyze` guard in src/ffmpeg.ts).
RUN set -eux; \
    ffmpeg -version; \
    ffprobe -version; \
    ffmpeg -hide_banner -encoders | grep -q libopus; \
    ffmpeg -hide_banner -encoders | grep -qw aac; \
    ffmpeg -hide_banner -encoders | grep -q pcm_s16le; \
    ffmpeg -hide_banner -filters | grep -q loudnorm; \
    ffmpeg -hide_banner -filters | grep -q astats; \
    ffmpeg -hide_banner -filters | grep -q aresample; \
    ffmpeg -v error -f s16le -ar 44100 -ac 2 -i /dev/urandom -t 1 \
      -map 0:a:0 -af loudnorm=I=-20:TP=-1.5:LRA=11 -ar 48000 -ac 2 \
      -c:a libopus -b:a 96k -y /tmp/smoke.opus; \
    ffmpeg -v error -f s16le -ar 44100 -ac 2 -i /dev/urandom -t 1 \
      -map 0:a:0 -af loudnorm=I=-20:TP=-1.5:LRA=11 -ar 48000 -ac 2 \
      -c:a aac -b:a 128k -movflags +faststart -y /tmp/smoke.m4a; \
    test -s /tmp/smoke.opus; \
    test -s /tmp/smoke.m4a; \
    ffprobe -v error -select_streams a:0 \
      -show_entries stream=duration,sample_rate,channels \
      -of default=nw=1 /tmp/smoke.opus | grep -q 'sample_rate=48000'; \
    ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate \
      -of default=nw=1 /tmp/smoke.m4a | grep -q 'sample_rate=48000'; \
    ffmpeg -v error -i /tmp/smoke.opus -ac 1 -ar 8000 -f s16le - | wc -c \
      | grep -qvw 0; \
    ffmpeg -hide_banner -i /tmp/smoke.m4a 2>&1 | grep -q 'Audio: aac'; \
    rm -f /tmp/smoke.opus /tmp/smoke.m4a

WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
USER node
CMD ["node", "dist/index.js"]
