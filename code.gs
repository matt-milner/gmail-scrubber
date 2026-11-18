
/**
 * AUTOMATED GMAIL CLEANUP
 * =======================
 *
 * Promotions: Move to Trash after 30 days
 * Social:     Move to Trash after 5 days
 *
 * Safeguards:
 * - Only processes Inbox messages
 * - Excludes starred and important messages
 * - Moves individual messages, not entire threads
 * - Rechecks eligibility before moving to Trash
 * - Supports dry-run testing
 *
 * Reporting:
 * - Sends a formatted HTML email after each run
 * - Lists EVERY successfully processed message
 * - Includes sender, subject, and date
 * - Reports totals, skipped messages, and all errors
 *
 * REQUIREMENT:
 * Enable Advanced Gmail Service (Gmail API v1)
 * in the Apps Script editor.
 */


// ============================================
// CONFIGURATION
// ============================================

// Email address that receives the daily report.
const REPORT_TO = "milner.s.matt@gmail.com";

// Set to true for testing.
// Set to false to actually move messages to Trash.
const DRY_RUN = false;

// Maximum messages processed PER CATEGORY per run.
// Additional eligible messages wait until the next run.
const MAX_PER_CATEGORY = 250;

// Cleanup rules.
const RULES = [
  {
    name: "Promotions",
    days: 30,
    label: "CATEGORY_PROMOTIONS",
    query:
      "in:inbox category:promotions older_than:30d " +
      "-is:starred -is:important"
  },
  {
    name: "Social",
    days: 5,
    label: "CATEGORY_SOCIAL",
    query:
      "in:inbox category:social older_than:5d " +
      "-is:starred -is:important"
  }
];


// ============================================
// MAIN CLEANUP FUNCTION
// ============================================

function cleanupGmail() {

  const timezone = Session.getScriptTimeZone();
  const runDate = new Date();

  const results = [];
  const errors = [];

  // Process each category independently.
  for (const rule of RULES) {

    const result = {
      name: rule.name,
      days: rule.days,
      processed: 0,
      skipped: 0,
      messages: [],
      hasMore: false
    };

    try {

      // Search individual Gmail messages.
      const response = Gmail.Users.Messages.list(
        "me",
        {
          q: rule.query,
          maxResults: MAX_PER_CATEGORY
        }
      );

      result.hasMore = Boolean(
        response.nextPageToken
      );

      const messages = response.messages || [];

      console.log(
        `${rule.name}: Found ${messages.length} messages.`
      );

      // Process individual messages.
      for (const item of messages) {

        try {

          // Retrieve message metadata.
          const msg = Gmail.Users.Messages.get(
            "me",
            item.id,
            {
              format: "metadata",
              metadataHeaders: [
                "From",
                "Subject",
                "Date"
              ]
            }
          );

          const labels = new Set(
            msg.labelIds || []
          );

          const timestamp = Number(
            msg.internalDate
          );

          // Calculate age threshold.
          const cutoff =
            Date.now() - rule.days * 86400000;

          // Revalidate eligibility.
          const eligible =
            labels.has("INBOX") &&
            labels.has(rule.label) &&
            !labels.has("STARRED") &&
            !labels.has("IMPORTANT") &&
            !labels.has("TRASH") &&
            Number.isFinite(timestamp) &&
            timestamp < cutoff;

          if (!eligible) {
            result.skipped++;
            continue;
          }

          // Extract message headers.
          const headers =
            msg.payload?.headers || [];

          const getHeader = name => {
            const match = headers.find(
              h => h.name.toLowerCase() ===
                   name.toLowerCase()
            );

            return match?.value || "(unknown)";
          };

          // Capture details for the report.
          const details = {
            sender: cleanText(
              getHeader("From"), 160
            ),
            subject: cleanText(
              getHeader("Subject"), 200
            ),
            date: Utilities.formatDate(
              new Date(timestamp),
              timezone,
              "MMM d, yyyy"
            ),
            id: item.id
          };

          // Move this individual message to Trash.
          // In dry-run mode, do nothing.
          if (!DRY_RUN) {
            Gmail.Users.Messages.trash(
              "me",
              item.id
            );
          }

          // Record only successful operations
          // (or eligible messages in dry-run mode).
          result.processed++;

          // Include EVERY processed message.
          // There is no report display limit.
          result.messages.push(details);

        } catch (err) {

          // Record message-level errors.
          const errorText =
            `${rule.name}: Message ${item.id}: ` +
            String(err.message || err);

          errors.push(errorText);
          console.error(errorText);

          // Continue with remaining messages.
        }
      }

    } catch (err) {

      // Record category-level search errors.
      const errorText =
        `${rule.name} search failed: ` +
        String(err.message || err);

      errors.push(errorText);
      console.error(errorText);
    }

    results.push(result);
  }


  // ==========================================
  // BUILD SUMMARY
  // ==========================================

  const totalProcessed = results.reduce(
    (sum, r) => sum + r.processed,
    0
  );

  const totalSkipped = results.reduce(
    (sum, r) => sum + r.skipped,
    0
  );

  const report = {
    date: Utilities.formatDate(
      runDate,
      timezone,
      "MMM d, yyyy"
    ),
    dryRun: DRY_RUN,
    processed: totalProcessed,
    skipped: totalSkipped,
    results: results,
    errors: errors
  };


  // ==========================================
  // SEND REPORT
  // ==========================================

  const htmlBody = buildHtmlReport(report);
  const textBody = buildTextReport(report);

  const status = errors.length > 0
    ? "Completed with Errors"
    : "Success";

  const action = DRY_RUN
    ? "Would trash"
    : "Trashed";

  const subject =
    `[Gmail Cleanup] ${status} - ` +
    `${action} ${totalProcessed} messages`;

  // Record the complete report in execution logs.
  console.log(textBody);

  try {

    MailApp.sendEmail({
      to: REPORT_TO,
      subject: subject,
      body: textBody,
      htmlBody: htmlBody,
      name: "Automated Gmail Cleanup"
    });

    console.log(
      "Cleanup report sent to " + REPORT_TO
    );

  } catch (err) {

    console.error(
      "Failed to send cleanup report: " +
      String(err.message || err)
    );

    // Throw the error so Apps Script's trigger
    // failure notification can detect it.
    throw err;
  }
}


// ============================================
// HTML EMAIL REPORT
// ============================================

function buildHtmlReport(report) {

  const heading = report.dryRun
    ? "Gmail Cleanup Preview"
    : "Gmail Cleanup Report";

  const action = report.dryRun
    ? "Would move to Trash"
    : "Moved to Trash";

  // Summary metric cards.
  const metrics = [
    [
      report.processed,
      report.dryRun ? "Eligible" : "Trashed"
    ],
    [report.skipped, "Skipped"],
    [report.errors.length, "Errors"]
  ].map(([number, label]) => `
    <td style="width:33%;
               padding:6px;
               text-align:center;">
      <div style="background:#f3f5f7;
                  padding:14px 4px;
                  border-radius:8px;">
        <div style="font-size:26px;
                    font-weight:bold;
                    color:#172033;">
          ${number}
        </div>
        <div style="font-size:12px;
                    color:#64748b;">
          ${label}
        </div>
      </div>
    </td>
  `).join("");


  // Build a section for each category.
  const sections = report.results.map(result => {

    // Display ALL successfully processed messages.
    const rows = result.messages.map(msg => `
      <tr>
        <td style="padding:10px 4px;
                   border-bottom:1px solid #e5e7eb;">
          <div style="font-weight:600;
                      color:#172033;
                      font-size:14px;
                      overflow-wrap:anywhere;">
            ${escapeHtml(msg.subject)}
          </div>

          <div style="font-size:12px;
                      color:#64748b;
                      margin-top:4px;
                      overflow-wrap:anywhere;">
            ${escapeHtml(msg.sender)}
            &nbsp;&middot;&nbsp;
            ${escapeHtml(msg.date)}
          </div>
        </td>
      </tr>
    `).join("");

    const messageList = rows || `
      <tr>
        <td style="padding:12px 4px;
                   color:#64748b;
                   font-size:13px;">
          No matching messages processed.
        </td>
      </tr>
    `;

    const pendingNotice = result.hasMore
      ? `
        <p style="font-size:12px;
                  color:#9a6700;">
          Additional matching messages remain
          for a future cleanup run.
        </p>
      `
      : "";

    return `
      <div style="margin-top:25px;">

        <h3 style="font-size:16px;
                   margin-bottom:4px;
                   color:#172033;">
          ${escapeHtml(result.name)}
          &mdash; ${result.processed} messages
        </h3>

        <p style="font-size:12px;
                  color:#64748b;
                  margin-top:0;">
          Older than ${result.days} days
        </p>

        <table style="border-collapse:collapse;
                      width:100%;">
          ${messageList}
        </table>

        ${pendingNotice}

        <p style="font-size:12px;
                  color:#64748b;">
          Skipped: ${result.skipped}
        </p>

      </div>
    `;
  }).join("");


  // Include ALL recorded errors.
  const errorSection = report.errors.length > 0
    ? report.errors.map(err => `
        <div style="padding:9px 0;
                    border-bottom:1px solid #fee2e2;
                    color:#a61b1b;
                    font-size:13px;
                    overflow-wrap:anywhere;">
          ${escapeHtml(err)}
        </div>
      `).join("")
    : `
      <p style="color:#16703c;
                font-size:13px;">
        &#10003; No errors encountered.
      </p>
    `;


  // Assemble the complete HTML email.
  return `
    <div style="background:#f3f5f7;
                padding:20px 10px;
                font-family:Arial,sans-serif;
                color:#172033;">

      <div style="max-width:650px;
                  margin:0 auto;
                  background:#ffffff;
                  border:1px solid #e2e8f0;
                  border-radius:12px;
                  padding:24px;">

        <h2 style="margin:0;
                   font-size:21px;">
          ${heading}
        </h2>

        <p style="color:#64748b;
                  font-size:13px;">
          ${report.date}
          ${report.dryRun
            ? " &middot; DRY RUN"
            : ""}
        </p>

        <table style="width:100%;
                      table-layout:fixed;">
          <tr>${metrics}</tr>
        </table>

        ${sections}

        <div style="margin-top:25px;
                    border-top:1px solid #e5e7eb;">

          <h3 style="font-size:16px;">
            Errors
          </h3>

          ${errorSection}

        </div>

        <p style="font-size:12px;
                  color:#64748b;
                  border-top:1px solid #e5e7eb;
                  padding-top:14px;
                  margin-top:25px;">

          ${action}: ${report.processed} messages.
          <br>

          ${report.dryRun
            ? "Dry run: No messages were moved to Trash."
            : "Messages were moved to Trash, not permanently deleted."}

        </p>

      </div>
    </div>
  `;
}


// ============================================
// PLAIN-TEXT EMAIL FALLBACK
// ============================================

function buildTextReport(report) {

  const lines = [
    "AUTOMATED GMAIL CLEANUP REPORT",
    "==============================",
    "",
    `Date: ${report.date}`,
    `Mode: ${report.dryRun ? "DRY RUN" : "LIVE"}`,
    "",
    "SUMMARY",
    "-------",
    `${report.dryRun ? "Eligible" : "Trashed"}: ${report.processed}`,
    `Skipped: ${report.skipped}`,
    `Errors: ${report.errors.length}`,
    ""
  ];

  // Include all successfully processed messages.
  for (const result of report.results) {

    lines.push(
      `${result.name.toUpperCase()} ` +
      `- ${result.processed} messages`
    );

    lines.push("-".repeat(40));

    if (result.messages.length === 0) {
      lines.push("No matching messages processed.");
    }

    for (const msg of result.messages) {
      lines.push(
        `${msg.date} | ${msg.sender} | ${msg.subject}`
      );
    }

    lines.push("");
    lines.push(`Skipped: ${result.skipped}`);

    if (result.hasMore) {
      lines.push(
        "Additional matching messages remain " +
        "for a future run."
      );
    }

    lines.push("");
  }

  // Include all recorded errors.
  lines.push("ERROR DETAILS");
  lines.push("-------------");

  if (report.errors.length === 0) {
    lines.push("No errors encountered.");
  } else {
    report.errors.forEach(
      err => lines.push(err)
    );
  }

  lines.push("");

  lines.push(
    report.dryRun
      ? "Dry run: No messages were moved to Trash."
      : "Messages were moved to Trash, not permanently deleted."
  );

  return lines.join("\n");
}


// ============================================
// UTILITY FUNCTIONS
// ============================================

// Prevent message content from injecting HTML
// into the report.
function escapeHtml(value) {

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


// Normalize whitespace and limit extremely
// long headers for readable reports.
function cleanText(value, maxLength) {

  return String(value)
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}
