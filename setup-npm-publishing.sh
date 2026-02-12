#!/bin/bash
set -e

echo "======================================"
echo "NPM Publishing Setup for webtalk"
echo "======================================"
echo ""
echo "This script will:"
echo "  1. Validate your npm token"
echo "  2. Create NPM_TOKEN GitHub secret"
echo "  3. Verify workflow setup"
echo ""

# Check prerequisites
echo "Checking prerequisites..."
MISSING=0

if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) not found"
    MISSING=1
else
    echo "✓ GitHub CLI found"
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm not found"
    MISSING=1
else
    echo "✓ npm found"
fi

if [ $MISSING -eq 1 ]; then
    echo ""
    echo "Install GitHub CLI: https://cli.github.com"
    exit 1
fi

echo ""

# Step 1: npm token input
echo "========================================"
echo "STEP 1: Provide npm Automation Token"
echo "========================================"
echo ""
echo "How to generate your token:"
echo "  1. Visit: https://www.npmjs.com/settings/tokens"
echo "  2. Click 'Generate New Token'"
echo "  3. Select 'Automation' type"
echo "  4. Optionally add description: 'GitHub Actions - webtalk'"
echo "  5. Click 'Create'"
echo "  6. COPY the token immediately (shown only once)"
echo ""
read -sp "Paste your npm token and press Enter: " NPM_TOKEN
echo ""
echo ""

if [ -z "$NPM_TOKEN" ]; then
    echo "❌ No token provided. Exiting."
    exit 1
fi

# Validate token format (should be ~40-50 chars, alphanumeric)
if ! [[ "$NPM_TOKEN" =~ ^[a-zA-Z0-9_-]+$ ]] || [ ${#NPM_TOKEN} -lt 20 ]; then
    echo "❌ Token format invalid. Should be alphanumeric string 20+ chars."
    exit 1
fi

echo "✓ Token format valid"
echo ""

# Step 2: Verify GitHub authentication
echo "========================================"
echo "STEP 2: Verify GitHub Authentication"
echo "========================================"
echo ""

if ! gh auth status 2>/dev/null | grep -q "Logged in"; then
    echo "❌ Not authenticated to GitHub. Please run: gh auth login"
    exit 1
fi

GITHUB_USER=$(gh auth status 2>&1 | grep "Logged in to" | head -1 | awk '{print $NF}' | tr -d '()')
echo "✓ Authenticated as: $GITHUB_USER"
echo ""

# Step 3: Set GitHub secret
echo "========================================"
echo "STEP 3: Creating GitHub Secret"
echo "========================================"
echo ""

REPO="AnEntrypoint/realtime-whisper-webgpu"
SECRET_NAME="NPM_TOKEN"

echo "Repository: https://github.com/$REPO"
echo "Secret name: $SECRET_NAME"
echo ""

# Create or update the secret
if echo "$NPM_TOKEN" | gh secret set "$SECRET_NAME" --repo "$REPO" 2>&1; then
    echo "✓ Secret set successfully"
else
    echo "❌ Failed to set secret"
    exit 1
fi

echo ""

# Step 4: Verify secret exists
echo "========================================"
echo "STEP 4: Verifying Secret"
echo "========================================"
echo ""

if gh secret list --repo "$REPO" 2>/dev/null | grep -q "$SECRET_NAME"; then
    echo "✓ $SECRET_NAME is available in GitHub Actions"
    echo ""
    echo "View it at:"
    echo "https://github.com/$REPO/settings/secrets/actions"
else
    echo "⚠ Warning: Could not verify secret in list"
    echo "Check GitHub manually at:"
    echo "https://github.com/$REPO/settings/secrets/actions"
fi

echo ""
echo "========================================"
echo "Setup Complete!"
echo "========================================"
echo ""
echo "Your webtalk npm package is now ready to publish automatically."
echo ""
echo "To publish a new version:"
echo "  1. Update version in package.json"
echo "  2. git add . && git commit -m 'bump version X.X.X'"
echo "  3. git push origin main"
echo "  4. GitHub Actions will publish to npm automatically"
echo ""
echo "Monitor at: https://github.com/$REPO/actions"
echo ""
