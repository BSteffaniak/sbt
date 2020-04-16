# Single Branch Tools

## Local Installation

1. `npm install -g .`

## Upgrading versions

1. `git pull`

If the global `sbt` executable does not update from the `git pull`, you can uninstall and reinstall to force the update:

1. `npm uninstall -g .`
1. `npm install -g .`

## Usage
(Run `sbt --help` after installation to see full docs)

_These commands must be ran from within a directory containing a sbt.json file._

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
  --auto-resolve-conflicts, --arc    Automatically resolve conflicts and create
                                     a merge commit (not correctly, though)
                                                                       [boolean]
  --quick                            Just quickly get the most up to date
                                     release info by creating a temp branch,
                                     then deleting it afterwards       [boolean]
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
                                   created on                [string] [required]
  --story-id                       What story to create a release for
                                                             [string] [required]
  --repo-path                      Path to git repo to create release from
                                                                        [string]
  --continue, -c                   Continue cherry-picking after addressing
                                   conflicts manually                  [boolean]
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
```
---

#### `sbt test-push`
(`sbt tp`)
```
Push current committed changes to a test git branch

Options:
  --help     Show help                                                 [boolean]
  --version  Show version number                                       [boolean]
  --stash    Stash changes before pushing test branch, and unstash them after
             pushing                                                   [boolean]
  --no-pull  Do not pull changes from origin/master before creating test branch
                                                                       [boolean]
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
