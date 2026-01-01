#!/bin/bash
set -e

echo "Installing Gyoshu..."

# 1. Create ~/.config/opencode/ if not exists
echo "Creating config directory: ~/.config/opencode/"
mkdir -p ~/.config/opencode/

# 2. Copy .opencode/* to ~/.config/opencode/ (excluding test files)
if [ -d ".opencode" ]; then
    echo "Copying extension files to ~/.config/opencode/"
    # Use rsync if available for better exclusion support
    if command -v rsync &> /dev/null; then
        rsync -a --exclude='*.test.ts' --exclude='*.test.js' --exclude='*/tests/*' --exclude='*/src/*' .opencode/ ~/.config/opencode/
    else
        # Fallback to cp, then clean up test files
        cp -r .opencode/* ~/.config/opencode/
        find ~/.config/opencode -name "*.test.ts" -delete 2>/dev/null || true
        find ~/.config/opencode -name "*.test.js" -delete 2>/dev/null || true
        rm -rf ~/.config/opencode/node_modules/*/src 2>/dev/null || true
    fi
else
    echo "Error: .opencode directory not found. Please run this script from the Gyoshu root directory."
    exit 1
fi

# 3. Sets up Python virtual environment if needed
VENV_DIR="$HOME/.gyoshu/venv"
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating Python virtual environment in $VENV_DIR..."
    python3 -m venv "$VENV_DIR"
    "$VENV_DIR/bin/pip" install --upgrade pip
    # psutil is optional but recommended
    "$VENV_DIR/bin/pip" install psutil || echo "Note: psutil installation failed, skipping optional dependency."
else
    echo "Python virtual environment already exists at $VENV_DIR"
fi

# 4. Success message
echo "--------------------------------------------------"
echo "Gyoshu installed successfully!"
echo "--------------------------------------------------"
echo "Quick Start:"
echo "  1. Start OpenCode: opencode"
echo "  2. Create a research plan: /gyoshu plan <your goal>"
echo "  3. Start autonomous research: /gyoshu-auto <your goal>"
echo ""
echo "Configuration stored in: ~/.config/opencode/"
echo "Virtual environment: $VENV_DIR"
echo "--------------------------------------------------"
