# Google Workspace

Access Gmail, Google Calendar, Google Drive, and other Google Workspace services via the `gog` CLI tool (gogcli).

## Prerequisites

Install gogcli: `brew install steipete/tap/gogcli` (macOS) or build from source.
Set up authentication: `gog auth credentials ~/path/to/client_secret.json && gog auth add you@gmail.com`
Set default account: `export GOG_ACCOUNT=you@gmail.com`

## Gmail

### Read emails
```bash
# List recent unread emails
gog gmail search 'is:unread newer_than:1d' --max 10 --json

# Search for specific emails
gog gmail search 'from:boss@company.com subject:urgent' --max 5 --json

# Read a specific email by ID
gog gmail get <message-id> --json
```

### Send emails
```bash
# Send an email
gog gmail send --to recipient@example.com --subject "Subject" --body "Email body"

# Send with CC
gog gmail send --to a@b.com --cc c@d.com --subject "FYI" --body "Content"
```

### Manage labels and organize
```bash
# List labels
gog gmail labels list --json

# Apply a label
gog gmail modify <message-id> --add-labels "Important"
```

## Google Calendar

### List events
```bash
# Today's events
gog calendar events --time-min "$(date -I)" --time-max "$(date -I -d '+1 day')" --json

# This week's events
gog calendar events --time-min "$(date -I)" --time-max "$(date -I -d '+7 days')" --max 20 --json

# Search events
gog calendar events --query "standup" --json
```

### Create events
```bash
# Create a meeting
gog calendar create --summary "Team Standup" --start "2026-04-27T09:00:00" --end "2026-04-27T09:30:00" --attendees "alice@co.com,bob@co.com"

# Create an all-day event
gog calendar create --summary "Company Holiday" --start "2026-05-01" --end "2026-05-02" --all-day
```

### Update and delete events
```bash
# Update an event
gog calendar update <event-id> --summary "Updated Title"

# Delete an event
gog calendar delete <event-id>
```

## Google Drive

### Search and list files
```bash
# List recent files
gog drive list --max 10 --json

# Search files
gog drive search "quarterly report" --json
```

### Download and upload
```bash
# Download a file
gog drive download <file-id> --output ./downloaded-file.pdf

# Upload a file
gog drive upload ./report.pdf --parent <folder-id>
```

## Tips

- Always use `--json` flag for structured output that's easier to parse
- Use `--max` to limit results and avoid overwhelming output
- For date ranges, use ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
- Check `gog --help` and `gog <service> --help` for all available commands
