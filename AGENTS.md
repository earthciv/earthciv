# Instructions for coding agents

These rules are for every AI coding agent that works on EarthCiv: Claude Code, Codex, Gemini, Antigravity, Cursor
and any other. `CLAUDE.md` and `GEMINI.md` only import this file, so change the rules here. If your checkout is
behind `origin/main`, read the current rules with `git show origin/main:AGENTS.md`.

[README.md](README.md) explains the project, how to run it and its commands.

## Every pull request shows its change in a screenshot

Put at least one screenshot of the change in the pull request's description, under a `## Screenshots` heading. Do
this for every pull request, including one that changes nothing a visitor sees. A pull request without a screenshot
is not ready for review or merge.

### What to capture

- **Your branch, as it will merge.** Run the site from the pull request's branch and capture that, not earthciv.org
  and not `main`. If a later commit changes what a screenshot shows, take it again and update the description.
- **A change a visitor can see:** the view that changed, at a size where the change is easy to spot. If it alters
  something that already existed, add the same view from `main` as "before". If it affects phones, add a capture at
  phone size (390×844).
- **A change with nothing new to see** (pipeline, data, tests, docs, settings): capture what shows that it works. That
  can be the view that uses the new data, the document as GitHub renders it, or the output of the command or test
  that exercises the change.
- **Screenshots are public.** Leave out tokens, email addresses, home folder paths and anything else private. Crop a
  terminal capture to the lines that matter.

### How to capture

- **A view of an edition:** the browser harness records it. [docs/HARNESS.md](docs/HARNESS.md) lists the views.

  ```sh
  uv run --group harness python -m harness record --edition ca --only '*home' --out out/shots
  # writes out/shots/ca/home.png (1280×800) and out/shots/ca/phone-home.png (390×844)
  ```

- **Anything else**, such as the world map or a state you reach by clicking: serve the site with
  `uv run python -m pipeline serve` (`--port N` if 8765 is taken) and capture it with Playwright, which is in the
  `harness` dependency group, or with your own browser tool.

Git ignores `out/`, so keep the files there.

### How to attach

GitHub has no API for the images people drag into a description. Publish yours with the harness instead:

```sh
uv run python -m harness attach out/shots/ca/home.png out/shots/ca/phone-home.png
```

It prints one Markdown image line per file. Put them in the description, each with a line saying what it shows:

```markdown
## Screenshots

The Canada edition's opening view with the new legend:

![home](https://raw.githubusercontent.com/earthciv/earthciv/<commit>/home.png)
```

- Do not commit screenshots to the pull request's branch: they would stay in `main`'s history. `attach` keeps them
  outside every branch ([how it works](docs/HARNESS.md#screenshots-for-a-pull-request)).
- Do not upload them to an image host outside GitHub.
- `attach` needs push access to `origin`. A person opening a pull request on github.com can drag the images into the
  description instead.

### Before merging

When you are asked to merge a pull request that has no screenshot, add one first, whoever opened it: capture its
branch as above and put the image in the description or in a comment.
