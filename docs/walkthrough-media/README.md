# Walkthrough media

Drop screenshots and animated GIFs into this folder using the filenames
referenced from `../VSCODE-EXTENSION-WALKTHROUGH.md`. Suggested filenames:

| File | Section | Type |
|------|---------|------|
| `00-hero.png` | 0. Before you start | still (optional cover image) |
| `01-autostart-daemon.gif` | 1. First launch — auto-starting the daemon | GIF |
| `02-sidebar-layout.png` | 2. Activity bar & sidebar layout | still |
| `03-feature-catalog.png` | 3. Feature catalog landing page | still |
| `04-tasks-live-updates.gif` | 4. Tasks view — list, statuses, status bar | GIF |
| `05-create-task-dryrun.gif` | 5. Creating a task (with optional Dry run) | GIF |
| `06-task-detail.png` | 6. Task detail panel | still (tall) |
| `07-cancellation-reason.gif` | 7. Cancelling a task and adding a reason | GIF |
| `08-approvals.gif` | 8. Approvals view | GIF |
| `09-agents-view.png` | 9. Agents view | still |
| `10-teams.gif` | 10. Teams | GIF |
| `11-skills.gif` | 11. Skills view | GIF |
| `12-automation.png` | 12. Automation view | still |
| `13-dispatch-chat.gif` | 13. Dispatch Chat panel | GIF |
| `14-switch-model.gif` | 14. Switching models | GIF |
| `15-memory-explorer.png` | 15. Memory Explorer & Recall | still (or two stitched) |
| `16-recover-paused.gif` | 16. Recovering paused tasks | GIF |
| `17-settings.png` | 17. Settings reference | still |
| `18-daemon-control.gif` | 18. Daemon control | GIF |

## Capture tips

- **GIFs**: keep under ~10 seconds and ~5 MB so they render smoothly on GitHub.
  Tools that work well: ScreenToGif (Windows), Kap (macOS), peek (Linux).
- **Screenshots**: use VS Code's "Light Modern" or "Dark Modern" theme for
  consistent contrast. Crop to the relevant pane(s) instead of full-window
  shots when you can.
- **Privacy**: scrub anything personal — repo paths, real ticket IDs, real
  names, API tokens. Use a throwaway worktree if needed.
- **Dimensions**: 1280×800 is a good middle ground for stills; GIFs can be
  smaller (e.g. 1024×640) to keep file size down.

Once you drop a file in, the matching reference in
`VSCODE-EXTENSION-WALKTHROUGH.md` will render it automatically — no other
edits needed.
