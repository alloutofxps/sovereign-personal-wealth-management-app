# Deploying, and getting back

Everything here was verified against the live project rather than recalled.
Where something is described from the product's structure rather than tested,
it says so.

## Where it lives

| | |
| --- | --- |
| Production URL | **https://sovereign-e5u.pages.dev** |
| Host | Cloudflare Pages, project `sovereign` |
| Cloudflare account | `parashar.pratik@yahoo.com` · `793c6da5a26b5579a7c28b652edc7d8b` |
| Source | https://github.com/alloutofxps/sovereign-personal-wealth-management-app — **public** |
| Production branch | `master` |
| Deploy method | direct upload of `dist/`. There is no Git connection: pushing to GitHub does **not** deploy, and deploying does not require a push. |

The bare `sovereign.pages.dev` subdomain was already taken globally, which is
why the project got the `-e5u` suffix.

## Getting back — the rollback route

### The permanent bookmark

Tag **`pre-redesign`** → commit `a318dd7`, 8 September 2026. The last commit
before phase 0 of the redesign, the state `design-refs/INVENTORY.md` was
derived from, and what production served until the redesign went out. It is an
annotated tag on the public remote and nothing later can move it.

```bash
git checkout pre-redesign
npm ci
npm run build
```

That reproduces the pre-redesign `dist/`. To put it back on the live URL:

```bash
npx wrangler pages deploy dist --project-name sovereign --branch master --commit-dirty=true
```

### The route that needs no rebuild at all

**Verified working.** Every Cloudflare Pages deployment keeps a permanent URL
of its own, and the pre-redesign build is at:

**https://01820cf4.sovereign-e5u.pages.dev**

Loaded and checked: it serves, `crossOriginIsolated` is `true`, and it is the
old app (no `.field` class in its CSS, which is the cleanest marker — the
three-surface hierarchy arrived in phase 2). If the new build is wrong, that
URL is the old one, available immediately, with nothing to rebuild.

### Rolling the main URL back from the dashboard

Cloudflare Pages retains deployment history — eight deployments are listed for
this project, the oldest a week old, and none has been pruned. The clicks,
**described from the product's structure rather than tested** (it needs your
login, so verify the wording as you go):

1. https://dash.cloudflare.com → the `parashar.pratik@yahoo.com` account
2. **Compute (Workers & Pages)** in the sidebar → the **`sovereign`** project
3. The **Deployments** tab. Production deployments are listed newest first.
4. Find the one whose *Source* column reads **`a318dd7`** — its id starts
   `01820cf4`. Date: 8 September.
5. The **⋯** menu at the right of that row → **Rollback to this deployment**,
   and confirm.

The direct link to that deployment:
https://dash.cloudflare.com/793c6da5a26b5579a7c28b652edc7d8b/pages/view/sovereign/01820cf4-d578-4eb7-8bd7-c9313b1200d4

List the deployments from the terminal instead with:

```bash
npx wrangler pages deployment list --project-name sovereign
```

## Deploying a new version

```bash
npm run typecheck && npm test -- --run && npm run lint
```

```bash
npm run build
```

```bash
npx wrangler pages deploy dist --project-name sovereign --branch master --commit-dirty=true
```

Two things to watch in the wrangler output:

- **"Uploading _headers"** — that file carries
  `Cross-Origin-Embedder-Policy: require-corp` and
  `Cross-Origin-Opener-Policy: same-origin`. Without them
  `crossOriginIsolated` is false and SQLite's classic OPFS VFS loses its
  fallback. `public/_headers` is copied into `dist/` by the build; if the line
  is missing from the output, stop and find out why.
- The deployment URL it prints. Keep it — that is the permanent bookmark for
  *this* build, and the rollback route for whatever comes after it.

## Checking a deploy actually took

A deploy that silently served a stale build is the failure worth guarding
against, so check markers rather than vibes. On the production URL:

| Check | Old app | New app |
| --- | --- | --- |
| `.field` in the stylesheet | absent | **present** |
| Both `[data-theme]` palettes | — | daylight **and** midnight |
| `svg[aria-label^="Where your money went"]` on `#/analytics` | present | **absent** — the Sankey was removed in phase 9 |
| `crossOriginIsolated` | true | true — must stay true |

## A note on two stale records

The deployment note in this project's memory said there was one deployment,
from 3 September, at commit `9057ebf`, and that the repo had no remote. Both
were out of date: there are eight deployments, production was at `a318dd7`
from 8 September, and the GitHub remote exists and is public. The figures were
repeated into a report before anyone checked them against
`wrangler pages deployment list`.

That is `AUDIT.md`'s M1 — a recorded fact read back as a current one — and it
is the reason this file exists rather than a paragraph in a conversation.
**Before relying on anything above, run the two list commands.** They are
cheap and they are the only things here that cannot go stale.
