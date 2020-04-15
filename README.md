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
  sbt release         Generate release info to stdout
  sbt wip-push        Push current staged and unstaged changes to wip git
                      branch, but do not commit                    [aliases: wp]
  sbt test-push       Push current committed changes to a test git branch
                                                                   [aliases: tp]
  sbt rebase-on-main  Rebase current branch onto the main branch and
                      fast-forward the main branch with new commits
  sbt config          Configure settings for current environment and storage

Options:
  --help     Show help                                                 [boolean]
  --version  Show version number                                       [boolean]

Examples:
  sbt release  Generate release info to stdout

```
---

#### `sbt release`
```
Generate release info to stdout

Options:
  --help                             Show help                         [boolean]
  --version                          Show version number               [boolean]
  --no-duplicate-header, --no-dupes  Do not print duplicate stories that are
                                     being removed before the output   [boolean]
  --sleep, -s                        Number of milliseconds to sleep between
                                     fetching info for pivotal stories  [number]
  --repo-path                        Path to git repo to pull version info from
                                                                        [string]
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
