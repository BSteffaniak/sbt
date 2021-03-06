# Single Branch Tools

## Local Installation

1. `npm install . -g`

## Upgrading versions

1. `sbt upgrade`

## Usage
(Run `sbt --help` after installation to see full docs)

#### `sbt`
```
Usage: sbt <command> [options]

Commands:
  sbt release-info    Generate release info
  sbt create-release  Cherry-pick commits related to a story to a specific
                      branch for a release
  sbt wip-push        Push current staged and unstaged changes to wip git
                      branch, but do not commit                    [aliases: wp]
  sbt test-push       Push current committed changes to a test git branch
                                                                   [aliases: tp]
  sbt rebase-on-main  Rebase current branch onto the main branch (master) and
                      fast-forward master with new commits
  sbt upgrade         Check for any updates and install them
  sbt check-updates   Check for any updates
  sbt config          Configure settings for current environment and storage

Options:
  --help     Show help                                                 [boolean]
  --version  Show version number                                       [boolean]

Examples:
  sbt release-info  Generate release info to stdout
```
---

#### `sbt release-info`
```
Generate release info

Options:
  --help                             Show help                         [boolean]
  --version                          Show version number               [boolean]
  --no-duplicate-header, --no-dupes  Do not print duplicate stories that are
                                     being removed before the output   [boolean]
  --sleep, -s                        Number of milliseconds to sleep between
                                     fetching info for pivotal stories  [number]
  --repo-path                        Path to git repo to pull version info from
                                                                        [string]
  --just-info, --dry, -d             Do not checkout release branch and merge
                                     origin/master automatically       [boolean]
  --continue, -c                     Continue pulling release info after
                                     addressing conflicts manually     [boolean]
  --skip-story-ids                   What stories to exclude from the release
                                                                         [array]
  --skip-commit-hashes               What commits to exclude from the release
                                                                         [array]
  --auto-resolve-conflicts, --arc    Automatically resolve conflicts and create
                                     a merge commit (not correctly, though)
                                                                       [boolean]
  --quick                            Just quickly get the most up to date
                                     release info by creating a temp branch,
                                     then deleting it afterwards       [boolean]
  --show-skipped                     Show stories that are being skipped from
                                     being included in the release because they
                                     are from previous releases        [boolean]
  --include-previously-accepted      Include stories that have been accepted
                                     between the previous deploy and current
                                     deploy, but have no actual code in current
                                     deploy           [boolean] [default: false]
  --push                             On successfully pulling release info, push
                                     the created branch                [boolean]
```
---

#### `sbt create-release`
```
Cherry-pick commits related to a story to a specific branch for a release

Options:
  --help                           Show help                           [boolean]
  --version                        Show version number                 [boolean]
  --release-branch-name            What to name the branch the release will be
                                   created on                           [string]
  --story-ids                      What stories to include in the release[array]
  --commit-hashes                  What commits to include in the release[array]
  --skip-story-ids                 What stories to exclude from the release
                                                                         [array]
  --skip-commit-hashes             What commits to exclude from the release
                                                                         [array]
  --repo-path                      Path to git repo to create release from
                                                                        [string]
  --continue, -c                   Continue cherry-picking after addressing
                                   conflicts manually                  [boolean]
  --recreate                       Recreate the release branch fresh based off
                                   of staging                          [boolean]
  --auto-resolve-conflicts, --arc  Automatically resolve conflicts and create a
                                   merge commit (not correctly, though)[boolean]
  --push                           On successfully creating release branch and
                                   cherry-picking commits, push the created
                                   branch                              [boolean]
```
---

#### `sbt wip-push`
(`sbt wp`)
```
Push current staged and unstaged changes to wip git branch, but do not commit

Options:
  --help     Show help                                                 [boolean]
  --version  Show version number                                       [boolean]
  --branch-name  Name the branch with a specific name                   [string]
```
---

#### `sbt test-push`
(`sbt tp`)
```
Push current committed changes to a test git branch

Options:
  --help         Show help                                             [boolean]
  --version      Show version number                                   [boolean]
  --stash        Stash changes before pushing test branch, and unstash them
                 after pushing                                         [boolean]
  --branch-name  Name the branch with a specific name                   [string]
  --no-pull      Do not pull changes from origin/master before creating test
                 branch                                                [boolean]
```
---

#### `sbt rebase-on-main`
```
sbt rebase-on-main

Rebase current branch onto the main branch and fast-forward the main branch with new commits

Options:
  --help     Show help                                                 [boolean]
  --version  Show version number                                       [boolean]
```
---

#### `sbt upgrade`
```
Check for any updates and install them

Options:
  --help     Show help                                                 [boolean]
  --version  Show version number                                       [boolean]
  -y         Auto respond 'yes' to any prompts                         [boolean]
```
---

#### `sbt check-updates`
```
Check for any updates

Options:
  --help     Show help                                                 [boolean]
  --version  Show version number                                       [boolean]
  -b         Print a boolean response                                  [boolean]
```
---

#### `sbt config`
_If no arguments are passed to the options, the value is returned from storage_
Example: `sbt config --wip-branch-id=199` to set wip branch id
Example: `sbt config --wip-branch-id` to get wip branch id
```
sbt config

Configure settings for current environment and storage

Options:
  --help                Show help                                      [boolean]
  --version             Show version number                            [boolean]
  --branch-id           ID of the most recently published test branch   [number]
  --wip-branch-id       ID of the most recently published WIP branch    [number]
  --test-branch-prefix  Prefix for branch names generated from test pushes
                                                                        [string]
  --wip-branch-prefix   Prefix for branch names generated from WIP pushes
                                                                        [string]
```
