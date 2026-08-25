#!/bin/sh
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec sh "$SCRIPT_DIR/host-app/gradlew" -p "$SCRIPT_DIR/host-app" "$@"
