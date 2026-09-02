#!/usr/bin/env just --justfile

project_dir := justfile_directory()

export PATH := project_dir + "/node_modules/.bin:" + env_var('PATH')

[private]
default:
    @just help

# Install dependencies
[group("dev")]
install:
    @echo "Installing dependencies..."
    npm install

# Clean node_modules
[group("dev")]
clean:
    @echo "Cleaning node_modules..."
    rm -rf node_modules

# Bump version, commit, tag, push, and create GitHub release to trigger npm publish
[group("release")]
release version:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "$(git status --porcelain)" ]]; then
        echo "Working tree is dirty - commit or stash changes first."
        exit 1
    fi
    echo "Bumping to v{{version}}..."
    npm version "{{version}}" --no-git-tag-version
    git add package.json
    git commit -m "release: v{{version}}"
    git tag "v{{version}}"
    git push && git push origin "v{{version}}"
    echo "Creating GitHub release v{{version}}..."
    gh release create "v{{version}}" --title "v{{version}}" --generate-notes
    echo "Release v{{version}} created - npm publish will run via GitHub Actions."

# Show available commands
[group("dev")]
help:
    @echo "Commands:"
    @echo "  install          - Install dependencies"
    @echo "  clean            - Clean node_modules"
    @echo "  release x.x.x   - Bump, tag, push, and publish to npm"
