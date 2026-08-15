#!/bin/sh
set -e

echo "=== Xcode Cloud Post-Clone Setup ==="

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

# 3. Install Pods in mobile/ios
cd "$CI_PRIMARY_REPOSITORY_PATH/mobile/ios"
echo "Installing CocoaPods in $(pwd)..."
pod install

echo "=== Xcode Cloud Setup Complete ==="
