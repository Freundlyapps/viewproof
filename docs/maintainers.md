# Maintainer notes

## Repository settings (GitHub → Settings)

- **Branches → branch protection on `main`:** require a pull request, require the `privacy` and `test` CI checks, block force pushes, and block deletion. Turn "block force pushes" off only for the duration of a history rewrite.
- **General → Pull requests:** allow squash merging only.
- **Actions → General:** require approval for first-time contributors' workflow runs.

## Removing private data from history

Use this only when the data cannot simply be revoked: a leaked token is revoked, not rewritten.

1. Back up first: `git bundle create ../backup.bundle --all`. Keep the bundle outside the repository.
2. Rewrite with `git filter-repo` (or `git filter-branch --index-filter` if filter-repo is not installed) so that only the affected file versions change. Check that the tree at the tip is unchanged.
3. Check that no commit still contains the data, then run `git reflog expire --expire=now --all && git gc --prune=now`.
4. Temporarily allow force pushes on `main`, then run `git push --force-with-lease=main:<old sha> origin main`, then block force pushes again.
5. Old commits can still be opened on GitHub by their ID until GitHub drops them. Ask GitHub Support to remove cached views ("Remove sensitive data"), listing the repository and the affected commit IDs.
6. Tell contributors who have a fork or a local clone. A force-push changes every commit ID after the edited one, and old commits must not come back through a merge.

### What contributors do after a rewrite

```bash
git fetch origin
git checkout main && git reset --hard origin/main   # discard the old history of main
git checkout my-branch
git rebase --onto origin/main <old-main-sha> my-branch   # replay only your own commits
git push --force-with-lease                            # update your pull request
```

Forks have to update their own `main` the same way. A pull request still based on the old history shows unrelated commits, and the maintainer asks for a rebase before merging.

The history was rewritten once, on 2026-11-22, to remove an IP address from `packages/core/test/fixtures/search-results-en.json` (old tip `26a78ff`, new tip `ea32b18`).
