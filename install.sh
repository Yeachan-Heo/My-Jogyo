#!/bin/bash
set -e

echo "Installing VibeSci..."

# 1. Create ~/.config/opencode/ if not exists
echo "Creating config directory: ~/.config/opencode/"
mkdir -p ~/.config/opencode/

# 2. Copy .opencode/* to ~/.config/opencode/
if [ -d ".opencode" ]; then
    echo "Copying extension files to ~/.config/opencode/"
    cp -r .opencode/* ~/.config/opencode/
else
    echo "Error: .opencode directory not found. Please run this script from the VibeSci root directory."
    exit 1
fi

# 3. Create ~/.vibesci/sessions/ directory
echo "Creating sessions directory: ~/.vibesci/sessions/"
mkdir -p ~/.vibesci/sessions/

# 4. Sets up Python virtual environment if needed
VENV_DIR="$HOME/.vibesci/venv"
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating Python virtual environment in $VENV_DIR..."
    python3 -m venv "$VENV_DIR"
    "$VENV_DIR/bin/pip" install --upgrade pip
    # psutil is optional but recommended
    "$VENV_DIR/bin/pip" install psutil || echo "Note: psutil installation failed, skipping optional dependency."
else
    echo "Python virtual environment already exists at $VENV_DIR"
fi

# 5. Success message
echo "--------------------------------------------------"
echo "VibeSci installed successfully!"
echo "--------------------------------------------------"
echo "Quick Start:"
echo "  1. Start OpenCode: opencode"
echo "  2. Create a research plan: /vibesci-plan <your goal>"
echo "  3. Start autonomous research: /vibesci-auto <your goal>"
echo ""
echo "Configuration stored in: ~/.config/opencode/"
echo "Sessions stored in: ~/.vibesci/sessions/"
echo "Virtual environment: $VENV_DIR"
echo "--------------------------------------------------"
