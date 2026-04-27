# Microsoft 365

Access Outlook email, Calendar, OneDrive, and Microsoft Teams via the Microsoft Graph API using `curl` or the `mgc` CLI.

## Prerequisites

### Option A: mgc CLI (Microsoft Graph CLI)
```bash
# Install
winget install Microsoft.Graph.CLI   # Windows
brew install microsoft/graph/mgc     # macOS

# Authenticate
mgc login --scopes "Mail.Read Mail.Send Calendars.ReadWrite"
```

### Option B: curl with access token
Obtain a token via Azure AD app registration or `az account get-access-token --resource https://graph.microsoft.com`.

## Outlook Email

### Read emails
```bash
# Recent emails (mgc)
mgc users mail-folders messages list --user-id me --top 10 --output json

# Recent emails (curl)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/me/messages?\$top=10&\$orderby=receivedDateTime desc" | jq

# Search emails
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/me/messages?\$search=\"subject:urgent\"&\$top=5" | jq

# Unread emails
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/me/messages?\$filter=isRead eq false&\$top=10" | jq
```

### Send emails
```bash
# Send an email (curl)
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "https://graph.microsoft.com/v1.0/me/sendMail" \
  -d '{
    "message": {
      "subject": "Subject line",
      "body": { "contentType": "Text", "content": "Email body text" },
      "toRecipients": [{ "emailAddress": { "address": "recipient@example.com" } }]
    }
  }'

# Reply to an email
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "https://graph.microsoft.com/v1.0/me/messages/{id}/reply" \
  -d '{ "comment": "Thanks for the update!" }'
```

## Calendar

### List events
```bash
# Today's events
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/me/calendarView?\$top=20&startDateTime=$(date -u +%Y-%m-%dT00:00:00Z)&endDateTime=$(date -u +%Y-%m-%dT23:59:59Z)" | jq '.value[] | {subject, start: .start.dateTime, end: .end.dateTime}'

# This week's events
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/me/events?\$top=20&\$orderby=start/dateTime" | jq

# Search events
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/me/events?\$filter=contains(subject,'standup')" | jq
```

### Create events
```bash
# Create a meeting
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "https://graph.microsoft.com/v1.0/me/events" \
  -d '{
    "subject": "Team Standup",
    "start": { "dateTime": "2026-04-27T09:00:00", "timeZone": "America/Chicago" },
    "end": { "dateTime": "2026-04-27T09:30:00", "timeZone": "America/Chicago" },
    "attendees": [
      { "emailAddress": { "address": "alice@company.com" }, "type": "required" }
    ]
  }'

# Create all-day event
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "https://graph.microsoft.com/v1.0/me/events" \
  -d '{
    "subject": "Company Holiday",
    "isAllDay": true,
    "start": { "dateTime": "2026-05-01", "timeZone": "UTC" },
    "end": { "dateTime": "2026-05-02", "timeZone": "UTC" }
  }'
```

### Update and delete events
```bash
# Update an event
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "https://graph.microsoft.com/v1.0/me/events/{id}" \
  -d '{ "subject": "Updated Title" }'

# Delete an event
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/me/events/{id}"
```

## OneDrive

### List and search files
```bash
# Root folder contents
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/me/drive/root/children" | jq '.value[] | {name, size, lastModifiedDateTime}'

# Search files
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/me/drive/root/search(q='quarterly report')" | jq
```

### Download and upload
```bash
# Download
curl -s -L -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/me/drive/items/{id}/content" -o file.pdf

# Upload (small file < 4MB)
curl -s -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @./report.pdf \
  "https://graph.microsoft.com/v1.0/me/drive/root:/Documents/report.pdf:/content"
```

## Tips

- Use `$select` to limit response fields: `?$select=subject,from,receivedDateTime`
- Use `$filter` for server-side filtering: `?$filter=importance eq 'high'`
- Use `$orderby` for sorting: `?$orderby=receivedDateTime desc`
- Date/time values use ISO 8601 format
- The mgc CLI is simpler for interactive use; curl is better for scripting
- Token refresh: use `az account get-access-token` for quick token refresh in scripts
