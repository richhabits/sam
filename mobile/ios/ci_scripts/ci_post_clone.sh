#!/bin/sh
set -e

echo "=== Xcode Cloud Post-Clone Setup ==="

# Set UTF-8 locale for Ruby & CocoaPods
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# 1. Install Node & CocoaPods if missing
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1

if ! command -v node >/dev/null 2>&1; then
  echo "Installing Node..."
  brew install node@22
  brew link --force --overwrite node@22
fi

if ! command -v pod >/dev/null 2>&1; then
  echo "Installing CocoaPods..."
  brew install cocoapods
fi

# 2. Install dependencies in mobile directory
cd "$CI_PRIMARY_REPOSITORY_PATH/mobile"
echo "Installing npm dependencies in $(pwd)..."
npm install --legacy-peer-deps

# 3. Pre-cache React Native & Hermes binaries with retries to prevent Maven Central connection drops
CACHE_DIR="${HOME}/Library/Caches/ReactNative"
mkdir -p "$CACHE_DIR"

fetch_cache() {
  url="$1"
  dest="$CACHE_DIR/$2"
  if [ ! -f "$dest" ]; then
    echo "Pre-fetching $2..."
    curl --retry 5 --retry-delay 2 --retry-connrefused -fsSL -o "$dest" "$url" || true
  fi
}

fetch_cache "https://repo1.maven.org/maven2/com/facebook/hermes/hermes-ios/250829098.0.16/hermes-ios-250829098.0.16-hermes-ios-debug.tar.gz" "hermes-ios-250829098.0.16-debug.tar.gz"
fetch_cache "https://repo1.maven.org/maven2/com/facebook/hermes/hermes-ios/250829098.0.16/hermes-ios-250829098.0.16-hermes-ios-release.tar.gz" "hermes-ios-250829098.0.16-release.tar.gz"
fetch_cache "https://repo1.maven.org/maven2/com/facebook/react/react-native-artifacts/0.86.2/react-native-artifacts-0.86.2-reactnative-dependencies-debug.tar.gz" "reactnative-dependencies-0.86.2-debug.tar.gz"
fetch_cache "https://repo1.maven.org/maven2/com/facebook/react/react-native-artifacts/0.86.2/react-native-artifacts-0.86.2-reactnative-dependencies-release.tar.gz" "reactnative-dependencies-0.86.2-release.tar.gz"

# 4. Install Pods in mobile/ios with retry loop
cd "$CI_PRIMARY_REPOSITORY_PATH/mobile/ios"
echo "Installing CocoaPods in $(pwd)..."

MAX_RETRIES=3
COUNT=0
until pod install || [ $COUNT -ge $MAX_RETRIES ]; do
  COUNT=$((COUNT + 1))
  if [ $COUNT -lt $MAX_RETRIES ]; then
    echo "pod install failed (attempt $COUNT/$MAX_RETRIES). Retrying in 5 seconds..."
    sleep 5
  fi
done

if [ $COUNT -ge $MAX_RETRIES ]; then
  echo "CocoaPods installation failed after $MAX_RETRIES attempts."
  exit 1
fi

echo "=== Xcode Cloud Setup Complete ==="
