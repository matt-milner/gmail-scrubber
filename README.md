# Automated Gmail Cleanup

A Google Apps Script that runs daily to move older Gmail **Promotions** and **Social** messages to Trash, while protecting starred and important messages. After each completed run, it emails a detailed report of the messages processed and any errors.

## Requirements

### Cleanup rules

| Category | Retention period | Gmail search |
| --- | --- | --- |
| Promotions | Move messages **older than 30 days** to Trash | `in:inbox category:promotions older_than:30d -is:starred -is:important` |
| Social | Move messages **older than 5 days** to Trash | `in:inbox category:social older_than:5d -is:starred -is:important` |

- Run **once every day** using an Apps Script time-driven trigger.
- Process **individual messages**, not entire conversation threads. A qualifying message can be trashed without moving newer, starred, or important messages in the same thread to Trash.
- Search **Inbox messages only**; archived messages are outside the current scope.
- Exclude messages that are **starred** or marked **important**.
- Recheck a message's Inbox/category/starred/important/Trash labels and age immediately before attempting to move it to Trash.
- **Move messages to Trash**, rather than permanently deleting them.
- Process at most **250 candidate messages per category per run** by default. Additional matching messages are left for later runs.

### Email report

Send a report to a configurable recipient after **every completed execution**, including when no messages qualify.

The report must:

1. Use a readable, **formatted HTML layout**, with a **plain-text alternative**.
2. Show counts for messages **moved to Trash** (or **eligible** in dry-run mode), **skipped**, and **errors**.
3. List **every successfully processed message** for **each category**—not just the first 3, 25, or 50. Each entry includes its **subject, sender, and date**.
4. Include **all errors captured during processing**, with the category, message ID when available, and the error description. Explicitly state when no errors occurred.
5. Clearly identify **dry-run versus live mode**.
6. Indicate when there may be additional matching messages beyond the per-category processing limit.

**Reporting scope:** “Every message” means every successfully processed message in the current run, up to the configured per-category processing cap; it does **not** mean every eligible message in the entire mailbox. The current script shortens exceptionally long sender fields to 160 characters and subjects to 200 characters for readability.

## Prerequisites

- A Google account with Gmail and access to [Google Apps Script](https://script.google.com/).
- An Apps Script project containing the complete `cleanupGmail` script.
- The **Advanced Gmail service**, **Gmail API v1**, enabled under **Services** in the Apps Script editor. Depending on project configuration or organization policy, the Gmail API may also need to be enabled in its associated Google Cloud project or approved by an administrator.
- Authorization for Gmail message access and outgoing report email (`MailApp`).
- A valid email address for report delivery.

## Configuration

Edit these constants near the top of the script:

```javascript
const REPORT_TO = "your.email@gmail.com";
const DRY_RUN = true;
const MAX_PER_CATEGORY = 250;
```

| Setting | Purpose |
| --- | --- |
| `REPORT_TO` | Destination email address for the daily report. |
| `DRY_RUN` | `true`: inspect eligible messages and email a preview **without moving anything to Trash**. `false`: perform the cleanup. |
| `MAX_PER_CATEGORY` | Maximum messages retrieved and processed per category in one execution (default: 250). |
| `RULES` | The two category search queries, age thresholds, and Gmail category labels. |

The current implementation has **no separate report-display limit**: it records every successfully processed message for the email. The script uses each message's Gmail `internalDate` to check its age again before acting.

## Setup

1. Open [Apps Script](https://script.google.com/) and create a project, or open the existing cleanup project.
2. Paste the complete `cleanupGmail` implementation into `Code.gs` and save.
3. Under **Services** in the left sidebar, click **+**, select **Gmail API**, choose **v1**, and add it.
4. Set `REPORT_TO` to the email address that should receive reports.
5. In **Project Settings**, verify the desired time zone (for example, `America/Denver`).
6. Keep `DRY_RUN = true`, select **`cleanupGmail`** from the function menu, and click **Run**. Review and grant the requested permissions.
7. Check the received email and execution logs. Confirm that the messages shown are appropriate and that the dry run did not move anything to Trash.
8. Set `DRY_RUN = false`, save, and manually run `cleanupGmail` once if you want to verify a live cleanup before scheduling.
9. Open **Triggers** (clock icon) > **Add Trigger**, and configure:
   - **Function:** `cleanupGmail`
   - **Deployment:** Head
   - **Event source:** Time-driven
   - **Trigger type:** Day timer
   - **Time of day:** Your preferred daily window
10. Save the trigger and enable **failure notifications** in Apps Script.

Time-driven triggers execute in the cloud; your computer does not need to remain on. Google schedules them within the chosen time window, not necessarily at an exact minute.

## How a run works

1. Search Promotions and Social **separately** using their respective Gmail queries.
2. Fetch up to `MAX_PER_CATEGORY` individual message IDs for each category using the Advanced Gmail service.
3. Retrieve metadata for each message, including its sender, subject, date, labels, and internal timestamp.
4. Revalidate eligibility. Count messages that no longer qualify as **skipped**.
5. In live mode, call the Gmail API's **message-level Trash operation**. Only after the operation succeeds does the script count the message as trashed and add it to the successful-message list. In dry-run mode, it instead counts and lists messages that would qualify.
6. Collect per-message and per-category exceptions, then continue processing where possible.
7. Build the complete HTML and plain-text report and send it to `REPORT_TO`.

## Interpreting the report

- **Trashed:** Messages successfully moved to Trash during a live run.
- **Eligible:** Messages that would have been moved to Trash in a dry run.
- **Skipped:** Messages returned by search that fail the subsequent eligibility check, such as a message that was starred or moved out of Inbox before processing.
- **Errors:** Captured failures to search, inspect, or trash messages. Details appear in the error section.
- **Additional messages remain:** The initial search reported another page of results beyond the per-category limit. These can be handled in a later run.

The **skipped** count does not include messages excluded by the search itself (such as messages already starred or marked important). A message that encounters a processing exception is recorded as an **error**, not as skipped.

## Safety and limitations

- **Recovery:** This script moves items to Gmail Trash; it does not immediately delete them permanently. Gmail normally permanently removes items from Trash after **30 days**.
- **No whole-thread deletion:** The implementation uses the Advanced Gmail API's per-message operations, not `GmailApp` methods that trash entire threads.
- **Execution limits:** Apps Script quotas, run-time limits, and Gmail API limits apply. With a large backlog, the script will need multiple daily executions to catch up.
- **Reporting limits:** Although the script does not deliberately truncate the list of processed messages, very large email bodies can exceed Apps Script or mail-service size limits and prevent delivery. It does not automatically split reports across multiple emails.
- **Unexpected termination:** If the execution times out or stops before report delivery, no email report may arrive—even if some messages were already moved to Trash. Keep Apps Script trigger failure notifications enabled.
- **Report-delivery failures:** If `MailApp.sendEmail` fails, the script logs the failure and throws an exception so that the Apps Script execution is marked failed. It does **not** undo messages already moved to Trash.
- **Captured error details:** The report includes every error caught and recorded by the script. Fatal termination before report construction/delivery cannot be included in that email.
- **Current scope:** The script does not delete archived messages, delete attachments independently, or permanently empty Trash.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `Gmail is not defined` | Enable **Gmail API v1** under **Services**. |
| Permission or API errors | Reauthorize the script, check organizational restrictions, and ensure the Gmail API is enabled where required. |
| No report received | Verify `REPORT_TO`, review **Executions** in Apps Script, check spam filtering, and confirm mail permissions/quotas. |
| No messages trashed | Check whether `DRY_RUN` remains `true`, and verify the Gmail searches in the mailbox. |
| Messages remain after a run | Check the 250-message-per-category cap and whether the report says more matches remain. |
| Skipped messages | Their category, Inbox status, star/importance, Trash status, or age no longer met the rule when rechecked. |

## Maintenance

Review the daily report and Apps Script execution history periodically. If retention requirements change, update the **days**, **query**, and associated rule settings together so the search and final age check stay aligned.

---

**Project entry point:** `cleanupGmail()`  
**Execution schedule:** Daily time-driven Apps Script trigger  
**Gmail access:** Advanced Gmail service (Gmail API v1)  
**Notification:** `MailApp.sendEmail()` with HTML and plain-text bodies
