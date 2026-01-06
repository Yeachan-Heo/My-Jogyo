#!/bin/bash
#
# 🎓 Gyoshu Installer
# Elegant installation for the research automation system
#
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Paths
OPENCODE_CONFIG="$HOME/.config/opencode"
OPENCODE_PLUGINS="$HOME/.opencode"

print_header() {
    echo ""
    echo -e "${BLUE}┌─────────────────────────────────────────────────────┐${NC}"
    echo -e "${BLUE}│${NC}  🎓 ${GREEN}Gyoshu${NC} — Research Automation Installer           ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}     ${YELLOW}교수 (Professor) + 조교 (Teaching Assistant)${NC}     ${BLUE}│${NC}"
    echo -e "${BLUE}└─────────────────────────────────────────────────────┘${NC}"
    echo ""
}

print_usage() {
    echo "Usage: ./install.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --link       Create symlinks (dev mode, auto-updates with git pull)"
    echo "  --copy       Copy files (default, standalone installation)"
    echo "  --uninstall  Remove Gyoshu from OpenCode"
    echo "  --check      Verify installation status"
    echo "  --help       Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./install.sh              # Standard installation (copy)"
    echo "  ./install.sh --link       # Developer mode (symlink)"
    echo "  ./install.sh --uninstall  # Remove Gyoshu"
    echo ""
}

check_requirements() {
    echo -e "🔍 ${CYAN}Checking requirements...${NC}"
    
    # Check Python
    if command -v python3 &> /dev/null; then
        PY_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
        PY_MAJOR=$(echo "$PY_VERSION" | cut -d. -f1)
        PY_MINOR=$(echo "$PY_VERSION" | cut -d. -f2)
        if [ "$PY_MAJOR" -gt 3 ] || ([ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -ge 10 ]); then
            echo -e "   ${GREEN}✓${NC} Python $PY_VERSION"
        else
            echo -e "   ${RED}✗${NC} Python $PY_VERSION (need 3.10+)"
            exit 1
        fi
    else
        echo -e "   ${RED}✗${NC} Python 3 not found"
        exit 1
    fi
    
    # Check OpenCode
    if command -v opencode &> /dev/null; then
        echo -e "   ${GREEN}✓${NC} OpenCode installed"
    else
        echo -e "   ${YELLOW}⚠${NC} OpenCode not in PATH (install from github.com/opencode-ai/opencode)"
    fi
}

get_source_dir() {
    local script_dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
    if [ -d "$script_dir/src" ]; then
        echo "$script_dir"
    else
        echo -e "📥 ${CYAN}Downloading Gyoshu...${NC}" >&2
        local temp_dir=$(mktemp -d)
        set +e
        git clone --depth 1 --quiet https://github.com/Yeachan-Heo/My-Jogyo.git "$temp_dir" >&2
        local clone_status=$?
        set -e
        if [ $clone_status -ne 0 ] || [ ! -d "$temp_dir/src" ]; then
            rm -rf "$temp_dir" 2>/dev/null || true
            echo -e "${RED}Failed to clone repository. Check your network connection.${NC}" >&2
            exit 1
        fi
        echo "$temp_dir"
    fi
}

install_link() {
    local source_dir="$1"
    
    echo -e "🔗 ${CYAN}Installing with symlinks (dev mode)...${NC}"
    
    # Create config directory
    mkdir -p "$OPENCODE_CONFIG"
    
    # Symlink each subdirectory
    for dir in agent command tool skill bridge lib plugin; do
        if [ -d "$source_dir/src/$dir" ]; then
            # Remove existing (file, link, or dir)
            rm -rf "$OPENCODE_CONFIG/$dir"
            # Create symlink
            ln -sf "$source_dir/src/$dir" "$OPENCODE_CONFIG/$dir"
            echo -e "   ${GREEN}✓${NC} Linked $dir/"
        fi
    done
    
    echo ""
    echo -e "   ${CYAN}ℹ${NC}  Dev mode: Changes sync automatically with git pull"
}

install_copy() {
    local source_dir="$1"
    
    echo -e "📋 ${CYAN}Installing (copy mode)...${NC}"
    
    # Create config directory
    mkdir -p "$OPENCODE_CONFIG"
    
    # Copy each subdirectory
    for dir in agent command tool skill bridge lib plugin; do
        if [ -d "$source_dir/src/$dir" ]; then
            # Remove existing
            rm -rf "$OPENCODE_CONFIG/$dir"
            # Copy (excluding tests)
            if command -v rsync &> /dev/null; then
                rsync -a \
                    --exclude='*.test.ts' \
                    --exclude='*.test.js' \
                    --exclude='__pycache__' \
                    "$source_dir/src/$dir" "$OPENCODE_CONFIG/"
            else
                cp -r "$source_dir/src/$dir" "$OPENCODE_CONFIG/"
                find "$OPENCODE_CONFIG/$dir" -name "*.test.ts" -delete 2>/dev/null || true
            fi
            echo -e "   ${GREEN}✓${NC} Copied $dir/"
        fi
    done
}

uninstall() {
    echo -e "🗑️  ${CYAN}Uninstalling Gyoshu...${NC}"
    
    # Gyoshu-specific directories/files
    local gyoshu_items="agent/gyoshu.md agent/jogyo.md agent/baksa.md agent/jogyo-paper-writer.md agent/jogyo-feedback.md agent/jogyo-insight.md command/gyoshu.md command/gyoshu-auto.md tool/gyoshu-completion.ts tool/gyoshu-snapshot.ts tool/python-repl.ts tool/notebook-writer.ts tool/notebook-search.ts tool/research-manager.ts tool/session-manager.ts tool/migration-tool.ts tool/retrospective-store.ts tool/checkpoint-manager.ts bridge skill/ml-rigor skill/scientific-method skill/experiment-design skill/data-analysis lib/quality-gates.ts lib/marker-parser.ts lib/notebook-frontmatter.ts lib/report-markdown.ts lib/pdf-export.ts lib/paths.ts lib/atomic-write.ts lib/cell-identity.ts lib/checkpoint-schema.ts lib/environment-capture.ts lib/session-lock.ts lib/readme-index.ts lib/filesystem-check.ts lib/artifact-security.ts plugin/gyoshu-hooks.ts"
    
    for item in $gyoshu_items; do
        if [ -e "$OPENCODE_CONFIG/$item" ] || [ -L "$OPENCODE_CONFIG/$item" ]; then
            rm -rf "$OPENCODE_CONFIG/$item"
            echo -e "   ${GREEN}✓${NC} Removed $item"
        fi
    done
    
    echo ""
    echo -e "${GREEN}✓ Gyoshu uninstalled${NC}"
    echo -e "  Other extensions in ~/.config/opencode/ are preserved."
}

check_install() {
    echo -e "🩺 ${CYAN}Checking Gyoshu installation...${NC}"
    echo ""
    
    local passed=0
    local failed=0
    
    # Check core files
    local core_files="command/gyoshu.md command/gyoshu-auto.md agent/gyoshu.md agent/jogyo.md bridge/gyoshu_bridge.py"
    
    for file in $core_files; do
        if [ -e "$OPENCODE_CONFIG/$file" ]; then
            if [ -L "$OPENCODE_CONFIG/$file" ]; then
                echo -e "   ${GREEN}✓${NC} $file (symlink)"
            else
                echo -e "   ${GREEN}✓${NC} $file"
            fi
            passed=$((passed + 1))
        else
            echo -e "   ${RED}✗${NC} $file (missing)"
            failed=$((failed + 1))
        fi
    done
    
    echo ""
    if [ $failed -eq 0 ]; then
        echo -e "${GREEN}All checks passed!${NC} Gyoshu is ready."
        echo ""
        echo -e "Start with: ${BLUE}opencode${NC} then ${BLUE}/gyoshu${NC}"
        return 0
    else
        echo -e "${RED}$failed check(s) failed.${NC} Run ./install.sh to fix."
        return 1
    fi
}

print_success() {
    echo ""
    echo -e "${GREEN}┌─────────────────────────────────────────────────────┐${NC}"
    echo -e "${GREEN}│${NC}  ✅ ${GREEN}Installation Complete!${NC}                          ${GREEN}│${NC}"
    echo -e "${GREEN}└─────────────────────────────────────────────────────┘${NC}"
    echo ""
    echo -e "🚀 ${GREEN}Quick Start:${NC}"
    echo ""
    echo -e "   1. ${BLUE}cd your-project && opencode${NC}"
    echo -e "   2. ${BLUE}/gyoshu analyze customer churn patterns${NC}"
    echo ""
    echo -e "📖 Docs: ${CYAN}https://github.com/Yeachan-Heo/My-Jogyo${NC}"
    echo ""
}

# Main
print_header

case "${1:-}" in
    --help|-h)
        print_usage
        exit 0
        ;;
    --check)
        check_install
        exit $?
        ;;
    --uninstall)
        uninstall
        exit 0
        ;;
    --link)
        check_requirements
        SOURCE_DIR=$(get_source_dir)
        install_link "$SOURCE_DIR"
        print_success
        ;;
    --copy|"")
        check_requirements
        SOURCE_DIR=$(get_source_dir)
        install_copy "$SOURCE_DIR"
        print_success
        ;;
    *)
        echo -e "${RED}Unknown option: $1${NC}"
        print_usage
        exit 1
        ;;
esac
