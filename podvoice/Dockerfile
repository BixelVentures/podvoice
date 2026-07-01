# Supervisor 2026.04.0+ no longer auto-injects BUILD_FROM, so we declare an
# explicit ARG default. CI builds with `docker buildx --platform linux/arm64`
# (home-assistant/builder is deprecated). See PLAN.md §6 B.3 / §11.
ARG BUILD_FROM=ghcr.io/home-assistant/aarch64-base-python:3.12-alpine3.21
FROM ${BUILD_FROM}

ENV LANG=C.UTF-8 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# `flac` = the reply-audio encoder. The Voice PE's on-device micro_decoder rejects our
# streaming WAV at file-type detection ("Could not determine audio file type") but decodes
# FLAC natively (it's what HA sends the device for TTS). We pipe the reply PCM through the
# flac CLI (see reply.encode_flac) so the announce path actually plays out loud.
RUN apk add --no-cache flac

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY gatekeeper/ ./gatekeeper/
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD ["/run.sh"]
